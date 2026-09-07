'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { ProAudioEngine, ProMeterData, ExportBitDepth, DitherType, ExportFormat } from '@/lib/pro-engine';
import {
  Stem,
  StemType,
  StemProcessing,
  MasterProcessing,
  MeterData,
  TransportState,
  Preset,
  AudioClip,
  SongSection,
  BusState,
  BusId,
  SendFxId,
  TrackRole,
  DeliveryMetadata,
  BounceMode,
  Marker,
  Region,
  ProjectSessionV2,
  defaultBusIdForStem,
} from '@/types/audio';
import {
  defaultStemProcessing,
  defaultMasterProcessing,
  defaultTransport,
  defaultMeterData,
  createDefaultBuses,
  defaultDeliveryMetadata,
} from '@/lib/defaults';
import { generateId } from '@/lib/utils';
import { autoMixAndMaster, AutoMixResult, analyzeAndMasterTrack, QuickMasterResult } from '@/lib/auto-mix';
import { separateStems } from '@/lib/stem-separator';
import { optimizeBeat, analyzeBeat, BeatOptimizeSettings, BeatAnalysis, autoOptimizeBeat } from '@/lib/beat-optimizer';
import { correctPitch, detectKey } from '@/lib/pitch-correction';
import { applyVocalEffects } from '@/lib/vocal-effects';
import { applyMasteringChain } from '@/lib/mastering-chain';
import { detectSonicCharacter, getProcessingProfile } from '@/lib/sonic-character';
import { autoLevelTrack, LevelingResult, LevelingMode } from '@/lib/audio-leveler';
import { runAutotuneStation, AutotuneStationResult } from '@/lib/autotune-station';
import { runVocalFixStation, VocalFixResult } from '@/lib/vocal-fix';
import {
  runAssemblyLine,
  AssemblyLineReportData,
  AssemblyStageId,
  ASSEMBLY_STAGE_LABELS,
} from '@/lib/assembly-line';
import { runAudioRepair, defaultRepairSettings, RepairResult } from '@/lib/audio-repair';
import { MicRecorder, createClickBuffer } from '@/lib/recorder';
import { saveAudioBuffer, loadAudioBuffer, saveProjectMeta, loadProjectMeta } from '@/lib/project-store';

const defaultProMeter: ProMeterData = {
  ...defaultMeterData,
  momentaryLUFS: -Infinity,
  shortTermLUFS: -Infinity,
  integratedLUFS: -Infinity,
  truePeakL: -Infinity,
  truePeakR: -Infinity,
  peakHoldL: -Infinity,
  peakHoldR: -Infinity,
  phaseCorrelation: 1,
  compressorGR: 0,
  limiterGR: 0,
  bandLevels: [0, 0, 0, 0],
  bandGR: [0, 0, 0, 0],
};

function defaultSends(): Partial<Record<SendFxId, number>> {
  return { reverb: 0, delay: 0 };
}

function makeDefaultClip(stemId: string, duration: number, startTime = 0): AudioClip {
  return {
    id: generateId(),
    stemId,
    bufferId: stemId,
    startTime,
    offset: 0,
    duration,
    fadeIn: 0,
    fadeOut: 0,
    gain: 1,
  };
}

function stemBaseName(name: string): string {
  return name.replace(/\s*[—-]\s*.+$/, '').trim();
}

function cloneStemProcessing(proc: StemProcessing = defaultStemProcessing): StemProcessing {
  return {
    ...proc,
    eq: proc.eq.map((b) => ({ ...b })),
    compressor: { ...proc.compressor },
    saturation: { ...proc.saturation },
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJson(data: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}

// Interpolate automation value at a given time
function interpolateAutomation(points: { time: number; value: number }[], time: number, min: number, max: number): number {
  if (points.length === 0) return (min + max) / 2;
  if (points.length === 1) return min + points[0].value * (max - min);
  if (time <= points[0].time) return min + points[0].value * (max - min);
  if (time >= points[points.length - 1].time) return min + points[points.length - 1].value * (max - min);
  for (let i = 1; i < points.length; i++) {
    if (time <= points[i].time) {
      const t = (time - points[i - 1].time) / (points[i].time - points[i - 1].time);
      const normalized = points[i - 1].value + t * (points[i].value - points[i - 1].value);
      return min + normalized * (max - min);
    }
  }
  return min + points[points.length - 1].value * (max - min);
}

// Apply a single automation value to the engine
function applyAutomationValue(engine: ProAudioEngine, stemId: string, parameter: string, value: number) {
  const channel = engine.stemChannels.get(stemId);
  if (!channel) return;
  switch (parameter) {
    case 'gain': channel.setGain(value); break;
    case 'pan': channel.setPan(value); break;
    case 'compressor.threshold': channel.setCompressorThreshold(value); break;
    case 'compressor.ratio': channel.setCompressorRatio(value); break;
    default: break;
  }
}

export function useProAudioEngine() {
  const engineRef = useRef<ProAudioEngine | null>(null);
  const animFrameRef = useRef<number>(0);
  const workletsLoadedRef = useRef(false);
  const automationLanesRef = useRef<Record<string, any[]>>({});

  const [stems, setStems] = useState<Stem[]>([]);
  const [masterProcessing, setMasterProcessing] = useState<MasterProcessing>(defaultMasterProcessing);
  const [transport, setTransport] = useState<TransportState>(defaultTransport);
  const [abBypass, setAbBypass] = useState(false);
  const [selectedStemId, setSelectedStemId] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [masterMeter, setMasterMeter] = useState<MeterData>(defaultMeterData);
  const [proMeter, setProMeter] = useState<ProMeterData>(defaultProMeter);
  const [spectrumData, setSpectrumData] = useState<Float32Array | null>(null);
  const [stemMeters, setStemMeters] = useState<Record<string, number>>({});
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportBitDepth, setExportBitDepth] = useState<ExportBitDepth>(24);
  const [exportDither, setExportDither] = useState<DitherType>('noise-shaped');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav');

  // Undo/redo history
  const [history, setHistory] = useState<{ stems: Stem[]; master: MasterProcessing }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const maxHistoryLength = 50;

  // Loudness reference for matched A/B
  const [loudnessOffset, setLoudnessOffset] = useState(0);

  // Automation lanes per stem
  const [automationLanes, setAutomationLanes] = useState<Record<string, any[]>>({});
  // Keep ref in sync for use in animation frame
  useEffect(() => { automationLanesRef.current = automationLanes; }, [automationLanes]);
  const [engineReady, setEngineReady] = useState(false);
  const [workletsAvailable, setWorkletsAvailable] = useState(false);

  // Post-production / timeline
  const [buses, setBuses] = useState<BusState[]>(() => createDefaultBuses());
  const [clips, setClips] = useState<AudioClip[]>([]);
  const [sections, setSections] = useState<SongSection[]>([]);
  const [metadata, setMetadata] = useState<DeliveryMetadata>(() => ({ ...defaultDeliveryMetadata }));
  const [bounceMode, setBounceMode] = useState<BounceMode>('fullmix');
  const [videoOffsetMs, setVideoOffsetMs] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);

  // Repair station
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairProgress, setRepairProgress] = useState(0);
  const [repairMessage, setRepairMessage] = useState('');
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [repairTrackName, setRepairTrackName] = useState('');

  // Recording
  const [isArmed, setIsArmed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [inputPeak, setInputPeak] = useState(0);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const micRecorderRef = useRef<MicRecorder | null>(null);
  const recordPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metronomeSrcRef = useRef<AudioBufferSourceNode[]>([]);
  const busesRef = useRef(buses);
  useEffect(() => { busesRef.current = buses; }, [buses]);
  const clipsRef = useRef(clips);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  const transportLoopRef = useRef(transport);
  useEffect(() => { transportLoopRef.current = transport; }, [transport]);
  const regionsRef = useRef(regions);
  useEffect(() => { regionsRef.current = regions; }, [regions]);

  // Initialize engine with worklets
  const getEngine = useCallback(async () => {
    if (!engineRef.current) {
      engineRef.current = new ProAudioEngine();
      const loaded = await engineRef.current.loadWorklets();
      workletsLoadedRef.current = loaded;
      setWorkletsAvailable(loaded);
      setEngineReady(true);
    }
    return engineRef.current;
  }, []);

  // Animation loop for meters.
  // - Automation is applied every RAF tick (~60 fps) for sample-accurate-ish feel.
  // - Meter setStates are throttled to ~30 fps: meters don't benefit from 60 fps
  //   and the React re-renders cost more than the updates themselves.
  // - Spectrum buffer is reused (copy-in-place) to avoid per-frame GC churn.
  const spectrumBufRef = useRef<Float32Array | null>(null);
  const lastMeterUpdateRef = useRef(0);
  const METER_INTERVAL_MS = 33; // ~30 fps

  const startMetering = useCallback(() => {
    const update = (now: number) => {
      const engine = engineRef.current;
      if (!engine) {
        animFrameRef.current = requestAnimationFrame(update);
        return;
      }

      if (engine.getIsPlaying()) {
        // Automation is applied every frame (cheap, no React state).
        const currentTime = engine.getCurrentTime();
        const loopT = transportLoopRef.current;
        if (
          (engine.getLoopEnabled() || loopT.loop) &&
          loopT.loopEnd > loopT.loopStart &&
          currentTime >= loopT.loopEnd
        ) {
          engine.stop();
          engine.play(loopT.loopStart);
          setTransport((prev) => ({ ...prev, currentTime: loopT.loopStart, isPlaying: true }));
        }

        const playhead = engine.getCurrentTime();
        const lanes = automationLanesRef.current;
        if (lanes) {
          Object.entries(lanes).forEach(([stemId, stemLanes]) => {
            if (!Array.isArray(stemLanes) || stemLanes.length === 0) return;
            stemLanes.forEach((lane: any) => {
              if (!lane.points || lane.points.length === 0) return;
              const value = interpolateAutomation(lane.points, playhead, lane.min, lane.max);
              applyAutomationValue(engine, stemId, lane.parameter, value);
            });
          });
        }

        // Throttle UI updates to ~30 fps.
        if (now - lastMeterUpdateRef.current >= METER_INTERVAL_MS) {
          lastMeterUpdateRef.current = now;

          // Master meters (pro or fallback)
          const meterData = engine.masterChannel.getMeterData();
          setMasterMeter(meterData);

          // Pro meter data
          if (engine.workletsReady) {
            const pm = engine.masterChannel.getProMeterData();
            setProMeter(pm);
          }

          // Spectrum — reuse the Float32Array buffer to avoid GC pressure.
          const spectrum = engine.masterChannel.getSpectrumData();
          let buf = spectrumBufRef.current;
          if (!buf || buf.length !== spectrum.length) {
            buf = new Float32Array(spectrum.length);
            spectrumBufRef.current = buf;
          }
          buf.set(spectrum);
          // React uses reference equality; allocate a new view over the same buffer
          // so downstream components see a "new" array without copying the data.
          setSpectrumData(new Float32Array(buf.buffer, buf.byteOffset, buf.length));

          // Transport time
          setTransport((prev) => ({
            ...prev,
            currentTime: playhead,
            isPlaying: true,
          }));

          // Stem meters
          const meters: Record<string, number> = {};
          engine.stemChannels.forEach((channel, id) => {
            const data = channel.getTimeDomainData();
            let peak = 0;
            for (let i = 0; i < data.length; i++) {
              const abs = Math.abs(data[i]);
              if (abs > peak) peak = abs;
            }
            meters[id] = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
          });
          setStemMeters(meters);
        }
      }

      animFrameRef.current = requestAnimationFrame(update);
    };
    animFrameRef.current = requestAnimationFrame(update);
  }, []);

  useEffect(() => {
    startMetering();
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [startMetering]);

  // Add stems
  const addStems = useCallback(
    async (files: { file: File; type: StemType }[]) => {
      const engine = await getEngine();
      await engine.resume();

      const newStems: Stem[] = [];
      const newClips: AudioClip[] = [];
      for (const { file, type } of files) {
        try {
          const buffer = await engine.decodeFile(file);
          const id = generateId();
          const busId = defaultBusIdForStem(type);

          await engine.addStem(id, buffer, busId);

          const waveformData = ProAudioEngine.generateWaveformData(buffer, 800);

          const stem: Stem = {
            id,
            name: file.name.replace(/\.[^.]+$/, ''),
            type,
            file,
            audioBuffer: buffer,
            processing: cloneStemProcessing(),
            waveformData,
            peakLevel: 0,
            rmsLevel: 0,
            busId,
            sends: defaultSends(),
          };

          newStems.push(stem);
          newClips.push(makeDefaultClip(id, buffer.duration, 0));
        } catch (err) {
          console.error(`Failed to decode ${file.name}:`, err);
        }
      }

      setClips((prev) => [...prev, ...newClips]);
      setStems((prev) => {
        const updated = [...prev, ...newStems];
        let maxDuration = 0;
        updated.forEach((s) => {
          if (s.audioBuffer && s.audioBuffer.duration > maxDuration) {
            maxDuration = s.audioBuffer.duration;
          }
        });
        setTransport((t) => ({ ...t, duration: maxDuration }));
        return updated;
      });

      if (newStems.length > 0 && !selectedStemId) {
        setSelectedStemId(newStems[0].id);
      }
    },
    [getEngine, selectedStemId]
  );

  const removeStem = useCallback(
    (id: string) => {
      const engine = engineRef.current;
      if (engine) engine.removeStem(id);
      setStems((prev) => prev.filter((s) => s.id !== id));
      setClips((prev) => prev.filter((c) => c.stemId !== id));
      if (selectedStemId === id) setSelectedStemId(null);
    },
    [selectedStemId]
  );

  const updateStemProcessing = useCallback(
    (id: string, updates: Partial<StemProcessing>) => {
      setStems((prev) =>
        prev.map((stem) => {
          if (stem.id !== id) return stem;
          const newProcessing = { ...stem.processing, ...updates };
          const engine = engineRef.current;
          const channel = engine?.stemChannels.get(id);
          if (channel) channel.updateProcessing(newProcessing, abBypass);
          return { ...stem, processing: newProcessing };
        })
      );
    },
    [abBypass]
  );

  const updateMasterProcessing = useCallback(
    (updates: Partial<MasterProcessing>) => {
      setMasterProcessing((prev) => {
        const newProcessing = { ...prev, ...updates };
        const engine = engineRef.current;
        if (engine) engine.masterChannel.updateProcessing(newProcessing, abBypass);
        return newProcessing;
      });
    },
    [abBypass]
  );

  // Sync all processing
  const syncAllProcessing = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const anySolo = stems.some((s) => s.processing.solo);
    const anyBusSolo = buses.some((b) => b.solo);
    const soloedBuses = new Set(buses.filter((b) => b.solo).map((b) => b.id));
    stems.forEach((stem) => {
      const channel = engine.stemChannels.get(stem.id);
      if (channel) {
        const effectiveProcessing = { ...stem.processing };
        if (anySolo && !stem.processing.solo) effectiveProcessing.mute = true;
        const busId = stem.busId ?? defaultBusIdForStem(stem.type, stem.trackRole);
        if (anyBusSolo && !soloedBuses.has(busId)) effectiveProcessing.mute = true;
        channel.updateProcessing(effectiveProcessing, abBypass);
      }
    });
    engine.masterChannel.updateProcessing(masterProcessing, abBypass);
  }, [stems, masterProcessing, abBypass, buses]);

  useEffect(() => {
    syncAllProcessing();
  }, [syncAllProcessing]);

  // Transport
  const play = useCallback(async () => {
    const engine = await getEngine();
    engine.play();
    setTransport((prev) => ({ ...prev, isPlaying: true }));
  }, [getEngine]);

  const pause = useCallback(() => {
    const engine = engineRef.current;
    if (engine) engine.pause();
    setTransport((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    if (engine) engine.stop();
    setTransport((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
    setMasterMeter(defaultMeterData);
    setProMeter(defaultProMeter);
    setSpectrumData(null);
  }, []);

  const rewind = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      const wasPlaying = engine.getIsPlaying();
      engine.stop();
      if (wasPlaying) engine.play(0);
    }
    setTransport((prev) => ({ ...prev, currentTime: 0 }));
  }, []);

  const seek = useCallback((time: number) => {
    const engine = engineRef.current;
    if (engine) {
      const wasPlaying = engine.getIsPlaying();
      engine.stop();
      if (wasPlaying) engine.play(time);
    }
    setTransport((prev) => ({ ...prev, currentTime: time }));
  }, []);

  const toggleLoop = useCallback(() => {
    setTransport((prev) => {
      const nextLoop = !prev.loop;
      const loopStart = prev.loopStart || 0;
      const loopEnd = prev.loopEnd > loopStart ? prev.loopEnd : prev.duration || loopStart;
      const engine = engineRef.current;
      if (engine) engine.setLoop(nextLoop, loopStart, loopEnd);
      return { ...prev, loop: nextLoop, loopStart, loopEnd };
    });
  }, []);

  const setLoopFromRegion = useCallback((regionId: string) => {
    const region = regionsRef.current.find((r) => r.id === regionId);
    if (!region) return;
    const engine = engineRef.current;
    if (engine) engine.setLoop(true, region.start, region.end);
    setTransport((prev) => ({
      ...prev,
      loop: true,
      loopStart: region.start,
      loopEnd: region.end,
    }));
  }, []);

  const toggleABBypass = useCallback(() => {
    setAbBypass((prev) => {
      if (!prev) {
        // Entering bypass: measure current loudness to compensate
        const engine = engineRef.current;
        if (engine && engine.workletsReady) {
          const pm = engine.masterChannel.getProMeterData();
          setLoudnessOffset(pm.momentaryLUFS > -Infinity ? pm.momentaryLUFS : 0);
        }
      }
      return !prev;
    });
  }, []);

  // Push state to history for undo/redo
  const pushHistory = useCallback(() => {
    setHistory((prev) => {
      const entry = {
        stems: stems.map((s) => ({
          ...s,
          processing: {
            ...s.processing,
            eq: s.processing.eq.map((b) => ({ ...b })),
            compressor: { ...s.processing.compressor },
            saturation: { ...s.processing.saturation },
          },
        })),
        master: {
          ...masterProcessing,
          eq: masterProcessing.eq.map((b) => ({ ...b })),
          compressor: { ...masterProcessing.compressor },
          limiter: { ...masterProcessing.limiter },
          saturation: { ...masterProcessing.saturation },
          stereoWidth: { ...masterProcessing.stereoWidth },
          stereoImager: { ...masterProcessing.stereoImager },
        },
      };
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(entry);
      if (newHistory.length > maxHistoryLength) newHistory.shift();
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [stems, masterProcessing, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIdx = historyIndex - 1;
    const entry = history[newIdx];
    if (!entry) return;
    setHistoryIndex(newIdx);
    setStems(entry.stems);
    setMasterProcessing(entry.master);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIdx = historyIndex + 1;
    const entry = history[newIdx];
    if (!entry) return;
    setHistoryIndex(newIdx);
    setStems(entry.stems);
    setMasterProcessing(entry.master);
  }, [history, historyIndex]);

  const applyPreset = useCallback((preset: Preset) => {
    setActivePresetId(preset.id);
    setStems((prev) =>
      prev.map((stem) => {
        const presetStem = preset.stems[stem.type];
        if (!presetStem) return stem;
        const newProcessing = {
          ...stem.processing,
          ...presetStem,
          eq: presetStem.eq || stem.processing.eq,
          compressor: presetStem.compressor
            ? { ...stem.processing.compressor, ...presetStem.compressor }
            : stem.processing.compressor,
          saturation: presetStem.saturation
            ? { ...stem.processing.saturation, ...presetStem.saturation }
            : stem.processing.saturation,
        };
        return { ...stem, processing: newProcessing as StemProcessing };
      })
    );
    if (preset.master) {
      setMasterProcessing((prev) => ({
        ...prev,
        ...preset.master,
        eq: preset.master.eq || prev.eq,
        compressor: preset.master.compressor
          ? { ...prev.compressor, ...preset.master.compressor }
          : prev.compressor,
        limiter: preset.master.limiter
          ? { ...prev.limiter, ...preset.master.limiter }
          : prev.limiter,
        saturation: preset.master.saturation
          ? { ...prev.saturation, ...preset.master.saturation }
          : prev.saturation,
        stereoWidth: preset.master.stereoWidth
          ? { ...prev.stereoWidth, ...preset.master.stereoWidth }
          : prev.stereoWidth,
      }));
    }
  }, []);

  // Export with bit depth + dithering
  const prepareOfflineExport = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.exportClips = clipsRef.current;
    engine.exportBuses = busesRef.current;
  }, []);

  const bakeAutomationIntoStems = useCallback((source: Stem[]): Stem[] => {
    const lanes = automationLanesRef.current;
    if (!lanes) return source;
    return source.map((stem) => {
      const stemLanes = lanes[stem.id];
      if (!Array.isArray(stemLanes) || stemLanes.length === 0) return stem;
      const processing = cloneStemProcessing(stem.processing);
      stemLanes.forEach((lane: any) => {
        if (!lane.points || lane.points.length === 0) return;
        const avgNorm =
          lane.points.reduce((sum: number, p: { value: number }) => sum + p.value, 0) /
          lane.points.length;
        const value = lane.min + avgNorm * (lane.max - lane.min);
        switch (lane.parameter) {
          case 'gain':
            processing.gain = value;
            break;
          case 'pan':
            processing.pan = value;
            break;
          case 'compressor.threshold':
            processing.compressor.threshold = value;
            break;
          case 'compressor.ratio':
            processing.compressor.ratio = value;
            break;
          default:
            break;
        }
      });
      return { ...stem, processing };
    });
  }, []);

  const exportWAV = useCallback(async (overrideStems?: Stem[]) => {
    const engine = engineRef.current;
    const exportStems = bakeAutomationIntoStems(overrideStems ?? stems);
    if (!engine || exportStems.length === 0) return;

    setIsExporting(true);
    setExportProgress(0);
    prepareOfflineExport();

    try {
      const blob = await engine.exportWAV(
        exportStems,
        masterProcessing,
        transport.duration,
        exportBitDepth,
        exportDither,
        setExportProgress
      );

      const ditherSuffix = exportDither === 'noise-shaped' ? 'ns' : exportDither === 'tpdf' ? 'tpdf' : 'nodither';
      const suffix = exportBitDepth === 32 ? '32float' : `${exportBitDepth}bit-${ditherSuffix}`;
      downloadBlob(blob, `mix-export-${suffix}.wav`);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [stems, masterProcessing, transport.duration, exportBitDepth, exportDither, bakeAutomationIntoStems, prepareOfflineExport]);

  const exportMP3 = useCallback(async (overrideStems?: Stem[]) => {
    const engine = engineRef.current;
    const exportStems = bakeAutomationIntoStems(overrideStems ?? stems);
    if (!engine || exportStems.length === 0) return;

    setIsExporting(true);
    setExportProgress(0);
    prepareOfflineExport();

    try {
      const blob = await engine.exportMP3(
        exportStems,
        masterProcessing,
        transport.duration,
        320,
        setExportProgress
      );

      downloadBlob(blob, 'mix-export-320kbps.mp3');
    } catch (err) {
      console.error('MP3 export failed:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [stems, masterProcessing, transport.duration, bakeAutomationIntoStems, prepareOfflineExport]);

  const exportFLAC = useCallback(async (overrideStems?: Stem[]) => {
    const engine = engineRef.current;
    const exportStems = bakeAutomationIntoStems(overrideStems ?? stems);
    if (!engine || exportStems.length === 0) return;

    setIsExporting(true);
    setExportProgress(0);
    prepareOfflineExport();

    try {
      const blob = await engine.exportFLAC(
        exportStems,
        masterProcessing,
        transport.duration,
        exportBitDepth,
        exportDither,
        setExportProgress
      );

      const ext = blob.type === 'audio/flac' ? 'flac' : 'wav';
      downloadBlob(blob, `mix-export-${exportBitDepth}bit.${ext}`);
    } catch (err) {
      console.error('FLAC export failed:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [stems, masterProcessing, transport.duration, exportBitDepth, exportDither, bakeAutomationIntoStems, prepareOfflineExport]);

  const exportStemFile = useCallback(async (stemId: string) => {
    const engine = engineRef.current;
    const stem = stems.find((s) => s.id === stemId);
    if (!engine || !stem) return;

    setIsExporting(true);
    setExportProgress(0);

    try {
      const blob = await engine.exportStem(
        stem,
        masterProcessing,
        transport.duration,
        exportBitDepth,
        exportDither,
        setExportProgress
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stem.name}-export.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Stem export failed:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [stems, masterProcessing, transport.duration, exportBitDepth, exportDither]);

  const exportAllStems = useCallback(async () => {
    for (const stem of stems) {
      await exportStemFile(stem.id);
    }
  }, [stems, exportStemFile]);

  const doExport = useCallback(() => {
    if (exportFormat === 'mp3') {
      void exportMP3();
    } else if (exportFormat === 'flac') {
      void exportFLAC();
    } else {
      void exportWAV();
    }
  }, [exportFormat, exportWAV, exportMP3, exportFLAC]);

  const setDeliveryMetadata = useCallback((patch: Partial<DeliveryMetadata>) => {
    setMetadata((prev) => ({ ...prev, ...patch }));
  }, []);

  const bounceDelivery = useCallback(async () => {
    const sidecar = { ...metadata, bounceMode };
    downloadJson(sidecar, `delivery-${bounceMode}-metadata.json`);

    if (bounceMode === 'stems') {
      await exportAllStems();
      return;
    }

    if (bounceMode === 'instrumental') {
      const muted = stems.map((s) =>
        s.type === 'vocals'
          ? { ...s, processing: { ...s.processing, mute: true } }
          : s
      );
      if (exportFormat === 'mp3') await exportMP3(muted);
      else if (exportFormat === 'flac') await exportFLAC(muted);
      else await exportWAV(muted);
      return;
    }

    if (bounceMode === 'acapella') {
      const muted = stems.map((s) =>
        s.type === 'vocals'
          ? s
          : { ...s, processing: { ...s.processing, mute: true } }
      );
      if (exportFormat === 'mp3') await exportMP3(muted);
      else if (exportFormat === 'flac') await exportFLAC(muted);
      else await exportWAV(muted);
      return;
    }

    if (bounceMode === 'region') {
      const region = regions[0];
      if (region) {
        setTransport((prev) => ({
          ...prev,
          loop: true,
          loopStart: region.start,
          loopEnd: region.end,
        }));
        downloadJson(
          { ...sidecar, region },
          `delivery-region-${region.label || region.id}.json`
        );
      }
      doExport();
      return;
    }

    doExport();
  }, [
    metadata,
    bounceMode,
    exportAllStems,
    stems,
    exportFormat,
    exportMP3,
    exportFLAC,
    exportWAV,
    regions,
    doExport,
  ]);

  // Session save/load (v2 + v1)
  const saveSession = useCallback(async () => {
    const session: ProjectSessionV2 = {
      version: 2,
      savedAt: new Date().toISOString(),
      stems: stems.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        processing: s.processing,
        trackRole: s.trackRole,
        busId: s.busId,
        sends: s.sends,
        hasAudio: !!s.audioBuffer,
      })),
      masterProcessing,
      activePresetId,
      clips,
      sections,
      buses,
      markers,
      regions,
      metadata,
      videoOffsetMs,
      transport: {
        loop: transport.loop,
        loopStart: transport.loopStart,
        loopEnd: transport.loopEnd,
      },
    };

    for (const stem of stems) {
      if (stem.audioBuffer) {
        try {
          await saveAudioBuffer(`stem-${stem.id}`, stem.audioBuffer);
        } catch (err) {
          console.warn('Failed to persist stem buffer', stem.id, err);
        }
      }
    }
    try {
      await saveProjectMeta('current', session);
    } catch (err) {
      console.warn('Failed to persist project meta', err);
    }

    downloadJson(session, 'session.json');
  }, [
    stems,
    masterProcessing,
    activePresetId,
    clips,
    sections,
    buses,
    markers,
    regions,
    metadata,
    videoOffsetMs,
    transport.loop,
    transport.loopStart,
    transport.loopEnd,
  ]);

  const loadSession = useCallback(
    async (json: string) => {
      try {
        const session = JSON.parse(json);
        if (session.version === 2) {
          const v2 = session as ProjectSessionV2;
          setMasterProcessing((prev) => ({ ...prev, ...v2.masterProcessing }));
          setActivePresetId(v2.activePresetId);
          setClips(v2.clips ?? []);
          setSections(v2.sections ?? []);
          setBuses(v2.buses?.length ? v2.buses : createDefaultBuses());
          setMarkers(v2.markers ?? []);
          setRegions(v2.regions ?? []);
          setMetadata({ ...defaultDeliveryMetadata, ...(v2.metadata ?? {}) });
          setVideoOffsetMs(v2.videoOffsetMs ?? 0);
          setTransport((prev) => ({
            ...prev,
            loop: v2.transport?.loop ?? false,
            loopStart: v2.transport?.loopStart ?? 0,
            loopEnd: v2.transport?.loopEnd ?? 0,
          }));

          const engine = await getEngine();
          await engine.resume();
          // Clear existing stems from engine
          Array.from(engine.stemChannels.keys()).forEach((id) => engine.removeStem(id));

          const restored: Stem[] = [];
          let maxDuration = 0;
          for (const meta of v2.stems ?? []) {
            const buffer = meta.hasAudio ? await loadAudioBuffer(`stem-${meta.id}`) : null;
            const busId = meta.busId ?? defaultBusIdForStem(meta.type, meta.trackRole);
            if (buffer) {
              await engine.addStem(meta.id, buffer, busId);
              const channel = engine.stemChannels.get(meta.id);
              if (channel) channel.updateProcessing(meta.processing, false);
              if (meta.sends?.reverb) engine.setStemSend(meta.id, 'reverb', meta.sends.reverb);
              if (meta.sends?.delay) engine.setStemSend(meta.id, 'delay', meta.sends.delay);
              if (buffer.duration > maxDuration) maxDuration = buffer.duration;
            }
            restored.push({
              id: meta.id,
              name: meta.name,
              type: meta.type,
              file: null,
              audioBuffer: buffer,
              processing: meta.processing,
              waveformData: buffer ? ProAudioEngine.generateWaveformData(buffer, 800) : null,
              peakLevel: 0,
              rmsLevel: 0,
              trackRole: meta.trackRole,
              busId,
              sends: meta.sends ?? defaultSends(),
            });
          }
          setStems(restored);
          setTransport((t) => ({ ...t, duration: maxDuration }));
          if (v2.transport) {
            engine.setLoop(
              !!v2.transport.loop,
              v2.transport.loopStart ?? 0,
              v2.transport.loopEnd ?? 0
            );
          }
          // Apply bus gains
          (v2.buses ?? []).forEach((b) => {
            engine.setBusGain(b.id, b.gain);
            engine.setBusMute(b.id, b.mute);
          });
          return;
        }

        // v1 behavior
        if (session.masterProcessing) {
          setMasterProcessing((prev) => ({ ...prev, ...session.masterProcessing }));
        }
        if (session.activePresetId) {
          setActivePresetId(session.activePresetId);
        }
        if (session.stems) {
          setStems((prev) =>
            prev.map((stem) => {
              const saved = session.stems.find((s: { name: string }) => s.name === stem.name);
              if (saved) {
                return { ...stem, processing: saved.processing };
              }
              return stem;
            })
          );
        }
      } catch (err) {
        console.error('Failed to load session:', err);
      }
    },
    [getEngine]
  );

  // Markers & Regions
  const addMarker = useCallback((marker: Marker) => {
    setMarkers((prev) => [...prev, marker]);
  }, []);

  const removeMarker = useCallback((id: string) => {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const addRegion = useCallback((region: Region) => {
    setRegions((prev) => [...prev, region]);
  }, []);

  const removeRegion = useCallback((id: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Stem reorder
  const reorderStems = useCallback((fromIndex: number, toIndex: number) => {
    setStems((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, []);

  // Duplicate stem
  const duplicateStem = useCallback((stemId: string) => {
    const stem = stems.find((s) => s.id === stemId);
    if (!stem) return;
    const newId = stem.id + '-copy-' + Date.now();
    const busId = stem.busId ?? defaultBusIdForStem(stem.type, stem.trackRole);
    const newStem: Stem = {
      ...stem,
      id: newId,
      name: stem.name + ' (copy)',
      busId,
      sends: { ...(stem.sends ?? defaultSends()) },
      processing: cloneStemProcessing(stem.processing),
    };
    setStems((prev) => [...prev, newStem]);
    if (stem.audioBuffer) {
      setClips((prev) => [...prev, makeDefaultClip(newId, stem.audioBuffer!.duration, 0)]);
    }
    const engine = engineRef.current;
    if (engine && stem.audioBuffer) {
      void engine.addStem(newId, stem.audioBuffer, busId).then(() => {
        const channel = engine.stemChannels.get(newId);
        if (channel) channel.updateProcessing(newStem.processing, abBypass);
        const sends = newStem.sends;
        if (sends?.reverb) engine.setStemSend(newId, 'reverb', sends.reverb);
        if (sends?.delay) engine.setStemSend(newId, 'delay', sends.delay);
      });
    }
  }, [stems, abBypass]);

  // Sidechain routing state: maps target stem ID → source stem ID
  const [sidechainRoutes, setSidechainRoutes] = useState<Record<string, string>>({});

  const connectSidechain = useCallback((sourceId: string, targetId: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.connectSidechain(sourceId, targetId);
    setSidechainRoutes((prev) => ({ ...prev, [targetId]: sourceId }));
  }, []);

  const disconnectSidechain = useCallback((targetId: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.disconnectSidechain(targetId);
    setSidechainRoutes((prev) => {
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  }, []);

  const updateSidechainParams = useCallback((targetId: string, params: {
    threshold?: number;
    ratio?: number;
    attack?: number;
    release?: number;
    range?: number;
    mix?: number;
    filterFreq?: number;
    filterType?: number;
    filterQ?: number;
  }) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateSidechainParams(targetId, params);
  }, []);

  const updateTransientParams = useCallback((stemId: string, params: Record<string, number>) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateTransientParams(stemId, params);
  }, []);

  const updateGateParams = useCallback((stemId: string, params: Record<string, number>) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateGateParams(stemId, params);
  }, []);

  // Auto Mix & Master
  const [autoMixProgress, setAutoMixProgress] = useState(0);
  const [autoMixMessage, setAutoMixMessage] = useState('');
  const [isAutoMixing, setIsAutoMixing] = useState(false);
  const [autoMixAnalysis, setAutoMixAnalysis] = useState<AutoMixResult['analysis'] | null>(null);

  const runAutoMix = useCallback(async () => {
    if (stems.length === 0) return;
    setIsAutoMixing(true);
    setAutoMixProgress(0);
    setAutoMixMessage('Starting analysis...');

    // Run in a microtask to allow UI updates
    await new Promise((r) => setTimeout(r, 50));

    const result = autoMixAndMaster(stems, (progress, message) => {
      setAutoMixProgress(progress);
      setAutoMixMessage(message);
    });

    // Apply stem settings
    const engine = engineRef.current;
    setStems((prev) =>
      prev.map((stem) => {
        const settings = result.stemSettings[stem.id];
        if (!settings) return stem;
        if (engine) {
          const channel = engine.stemChannels.get(stem.id);
          if (channel) channel.updateProcessing(settings, abBypass);
        }
        return { ...stem, processing: settings };
      })
    );

    // Apply master settings
    setMasterProcessing(result.masterSettings);
    if (engine) {
      engine.masterChannel.updateProcessing(result.masterSettings, false);
    }

    setAutoMixAnalysis(result.analysis);

    // Brief delay so user sees 100%
    await new Promise((r) => setTimeout(r, 600));
    setIsAutoMixing(false);
    setAutoMixProgress(0);
    setAutoMixMessage('');
  }, [stems, abBypass]);

  // ── Quick Master: single-track upload → analyze → master ─────────
  const [isQuickMastering, setIsQuickMastering] = useState(false);
  const [quickMasterProgress, setQuickMasterProgress] = useState(0);
  const [quickMasterMessage, setQuickMasterMessage] = useState('');
  const [quickMasterResult, setQuickMasterResult] = useState<QuickMasterResult | null>(null);
  const [quickMasterTrackName, setQuickMasterTrackName] = useState('');

  const runQuickMaster = useCallback(async (file: File) => {
    setIsQuickMastering(true);
    setQuickMasterProgress(0);
    setQuickMasterMessage('Decoding audio...');
    setQuickMasterResult(null);
    const trackName = file.name.replace(/\.[^.]+$/, '');
    setQuickMasterTrackName(trackName);

    try {
      const engine = await getEngine();
      await engine.resume();

      setQuickMasterProgress(5);
      const buffer = await engine.decodeFile(file);

      // ══════════════════════════════════════════════════════════════
      // CLEAN MASTERING: Decode → Analyze → Master the ORIGINAL mix.
      // No stem separation. No pitch correction. No beat optimization.
      // No vocal effects. No dynamic arc. The original stereo mix is
      // preserved perfectly — only transparent mastering is applied.
      // ══════════════════════════════════════════════════════════════

      // ── Phase 1: Analyze the original mix ─────────────────────
      setQuickMasterProgress(10);
      setQuickMasterMessage('Analyzing track...');
      await new Promise((r) => setTimeout(r, 20));

      const trackAnalysis = analyzeAndMasterTrack(buffer, (p, m) => {
        setQuickMasterProgress(10 + p * 0.15);
        setQuickMasterMessage(m);
      });

      // ── Phase 2: Detect sonic character ───────────────────────
      setQuickMasterProgress(25);
      setQuickMasterMessage('Detecting sonic character...');
      await new Promise((r) => setTimeout(r, 20));

      const characterAnalysis = detectSonicCharacter(buffer);
      const processingProfile = getProcessingProfile(characterAnalysis.character, characterAnalysis.traits);

      setQuickMasterMessage(`Character: ${characterAnalysis.character} (${Math.round(characterAnalysis.confidence * 100)}% confidence)`);
      await new Promise((r) => setTimeout(r, 50));

      // ── Phase 3: Load original as a stem for playback ─────────
      setQuickMasterProgress(30);
      setQuickMasterMessage('Loading audio...');

      const originalId = generateId();
      const masterBusId = defaultBusIdForStem('fullmix');
      await engine.addStem(originalId, buffer, masterBusId);
      const waveformData = ProAudioEngine.generateWaveformData(buffer, 800);
      const originalStem: Stem = {
        id: originalId,
        name: `${trackName} — Original`,
        type: 'fullmix' as StemType,
        file: null,
        audioBuffer: buffer,
        processing: {
          ...defaultStemProcessing,
          eq: defaultStemProcessing.eq.map((b) => ({ ...b })),
          compressor: { ...defaultStemProcessing.compressor },
          saturation: { ...defaultStemProcessing.saturation },
          mute: true,
        },
        waveformData,
        peakLevel: 0,
        rmsLevel: 0,
        busId: masterBusId,
        sends: defaultSends(),
      };

      // ── Phase 4: Master the original stereo mix directly ──────
      setQuickMasterProgress(40);
      setQuickMasterMessage('Applying mastering chain...');
      await new Promise((r) => setTimeout(r, 0));

      const masteringResult = await applyMasteringChain(
        buffer,
        trackAnalysis.analysis,
        processingProfile.masteringApproach.targetLUFS,
        (p, m) => {
          setQuickMasterProgress(40 + p * 0.50);
          setQuickMasterMessage(m);
        },
        processingProfile.masteringApproach
      );

      // ── Phase 5: Store mastered result ────────────────────────
      setQuickMasterProgress(92);
      setQuickMasterMessage('Finalizing...');

      const masteredId = generateId();
      await engine.addStem(masteredId, masteringResult.buffer, masterBusId);
      const masteredWaveform = ProAudioEngine.generateWaveformData(masteringResult.buffer, 800);
      const masteredStem: Stem = {
        id: masteredId,
        name: `${trackName} — Mastered`,
        type: 'fullmix' as StemType,
        file: null,
        audioBuffer: masteringResult.buffer,
        processing: { ...defaultStemProcessing },
        waveformData: masteredWaveform,
        peakLevel: 0,
        rmsLevel: 0,
        busId: masterBusId,
        sends: defaultSends(),
      };

      setClips((prev) => [
        ...prev,
        makeDefaultClip(originalId, buffer.duration),
        makeDefaultClip(masteredId, masteringResult.buffer.duration),
      ]);
      setStems((prev) => {
        const updated = [...prev, originalStem, masteredStem];
        let maxDuration = 0;
        updated.forEach((s) => {
          if (s.audioBuffer && s.audioBuffer.duration > maxDuration) {
            maxDuration = s.audioBuffer.duration;
          }
        });
        setTransport((t) => ({ ...t, duration: maxDuration }));
        return updated;
      });

      // Mute the original so only the mastered version plays
      const origChannel = engine.stemChannels.get(originalId);
      if (origChannel) origChannel.updateProcessing({ ...originalStem.processing, mute: true }, false);

      setSelectedStemId(masteredId);

      // ── Build final report ────────────────────────────────────
      setQuickMasterResult({
        ...trackAnalysis,
        masteringStats: {
          finalLUFS: masteringResult.finalLUFS,
          truePeak: masteringResult.truePeak,
          pitchCorrected: false,
          effectsApplied: false,
          beatOptimized: false,
          sonicCharacter: characterAnalysis.character,
          characterConfidence: characterAnalysis.confidence,
        },
      });

      setQuickMasterProgress(100);
      setQuickMasterMessage('Auto Master complete!');
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error('Auto Master failed:', err);
      setQuickMasterMessage('Failed — check the file format and try again.');
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      setIsQuickMastering(false);
      setQuickMasterProgress(0);
      setQuickMasterMessage('');
    }
  }, [getEngine]);

  // ── Audio Levelling Station ───────────────────────────────────────
  const [isAutoLeveling, setIsAutoLeveling] = useState(false);
  const [autoLevelProgress, setAutoLevelProgress] = useState(0);
  const [autoLevelMessage, setAutoLevelMessage] = useState('');
  const [autoLevelResult, setAutoLevelResult] = useState<LevelingResult | null>(null);
  const [autoLevelTrackName, setAutoLevelTrackName] = useState('');

  const runAutoLevel = useCallback(async (file: File, mode: LevelingMode = 'mix') => {
    setIsAutoLeveling(true);
    setAutoLevelProgress(0);
    setAutoLevelMessage('Decoding audio...');
    setAutoLevelResult(null);
    const trackName = file.name.replace(/\.[^.]+$/, '');
    setAutoLevelTrackName(trackName);

    try {
      const engine = await getEngine();
      await engine.resume();
      const buffer = await engine.decodeFile(file);

      setAutoLevelMessage('Gain staging...');
      const result = await autoLevelTrack(buffer, { mode }, (p, m) => {
        setAutoLevelProgress(p);
        setAutoLevelMessage(m);
      });

      const originalId = generateId();
      const leveledId = generateId();
      const levelBusId = defaultBusIdForStem('fullmix');
      await engine.addStem(originalId, buffer, levelBusId);
      await engine.addStem(leveledId, result.buffer, levelBusId);

      const originalStem: Stem = {
        id: originalId,
        name: `${trackName} — Original`,
        type: 'fullmix' as StemType,
        file: null,
        audioBuffer: buffer,
        processing: {
          ...defaultStemProcessing,
          eq: defaultStemProcessing.eq.map((b) => ({ ...b })),
          compressor: { ...defaultStemProcessing.compressor },
          saturation: { ...defaultStemProcessing.saturation },
          mute: true,
        },
        waveformData: ProAudioEngine.generateWaveformData(buffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId: levelBusId,
        sends: defaultSends(),
      };
      const leveledStem: Stem = {
        id: leveledId,
        name: `${trackName} — Levelled`,
        type: 'fullmix' as StemType,
        file: null,
        audioBuffer: result.buffer,
        processing: { ...defaultStemProcessing },
        waveformData: ProAudioEngine.generateWaveformData(result.buffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId: levelBusId,
        sends: defaultSends(),
      };

      setClips((prev) => [
        ...prev,
        makeDefaultClip(originalId, buffer.duration),
        makeDefaultClip(leveledId, result.buffer.duration),
      ]);
      setStems((prev) => {
        const updated = [...prev, originalStem, leveledStem];
        let maxDuration = 0;
        updated.forEach((s) => {
          if (s.audioBuffer && s.audioBuffer.duration > maxDuration) maxDuration = s.audioBuffer.duration;
        });
        setTransport((t) => ({ ...t, duration: maxDuration }));
        return updated;
      });

      const origChannel = engine.stemChannels.get(originalId);
      if (origChannel) origChannel.updateProcessing({ ...originalStem.processing, mute: true }, false);
      setSelectedStemId(leveledId);
      setAutoLevelResult(result);
      setAutoLevelProgress(100);
      setAutoLevelMessage('Levelling complete!');
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error('Auto Level failed:', err);
      setAutoLevelMessage('Failed — check the file format and try again.');
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      setIsAutoLeveling(false);
      setAutoLevelProgress(0);
      setAutoLevelMessage('');
    }
  }, [getEngine]);

  // ── Auto-Tune Station ─────────────────────────────────────────────
  const [isAutotuning, setIsAutotuning] = useState(false);
  const [autotuneProgress, setAutotuneProgress] = useState(0);
  const [autotuneMessage, setAutotuneMessage] = useState('');
  const [autotuneResult, setAutotuneResult] = useState<AutotuneStationResult | null>(null);
  const [autotuneTrackName, setAutotuneTrackName] = useState('');

  const runAutotune = useCallback(async (file: File, intensity: number) => {
    setIsAutotuning(true);
    setAutotuneProgress(0);
    setAutotuneMessage('Decoding vocal...');
    setAutotuneResult(null);
    const trackName = file.name.replace(/\.[^.]+$/, '');
    setAutotuneTrackName(trackName);

    try {
      const engine = await getEngine();
      await engine.resume();
      const buffer = await engine.decodeFile(file);

      const result = await runAutotuneStation(buffer, intensity, (p, m) => {
        setAutotuneProgress(p);
        setAutotuneMessage(m);
      });

      const originalId = generateId();
      const tunedId = generateId();
      const vocalBusId = defaultBusIdForStem('vocals');
      await engine.addStem(originalId, buffer, vocalBusId);
      await engine.addStem(tunedId, result.buffer, vocalBusId);

      const originalStem: Stem = {
        id: originalId,
        name: `${trackName} — Original`,
        type: 'vocals' as StemType,
        file: null,
        audioBuffer: buffer,
        processing: {
          ...defaultStemProcessing,
          eq: defaultStemProcessing.eq.map((b) => ({ ...b })),
          compressor: { ...defaultStemProcessing.compressor },
          saturation: { ...defaultStemProcessing.saturation },
          mute: true,
        },
        waveformData: ProAudioEngine.generateWaveformData(buffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId: vocalBusId,
        sends: defaultSends(),
      };
      const tunedStem: Stem = {
        id: tunedId,
        name: `${trackName} — Auto-Tune ${result.label}`,
        type: 'vocals' as StemType,
        file: null,
        audioBuffer: result.buffer,
        processing: { ...defaultStemProcessing },
        waveformData: ProAudioEngine.generateWaveformData(result.buffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId: vocalBusId,
        sends: defaultSends(),
      };

      setClips((prev) => [
        ...prev,
        makeDefaultClip(originalId, buffer.duration),
        makeDefaultClip(tunedId, result.buffer.duration),
      ]);
      setStems((prev) => {
        const updated = [...prev, originalStem, tunedStem];
        let maxDuration = 0;
        updated.forEach((s) => {
          if (s.audioBuffer && s.audioBuffer.duration > maxDuration) maxDuration = s.audioBuffer.duration;
        });
        setTransport((t) => ({ ...t, duration: maxDuration }));
        return updated;
      });

      const origChannel = engine.stemChannels.get(originalId);
      if (origChannel) origChannel.updateProcessing({ ...originalStem.processing, mute: true }, false);
      setSelectedStemId(tunedId);
      setAutotuneResult(result);
      setAutotuneProgress(100);
      setAutotuneMessage('Auto-Tune complete!');
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error('Auto-Tune failed:', err);
      setAutotuneMessage('Failed — check the file format and try again.');
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      setIsAutotuning(false);
      setAutotuneProgress(0);
      setAutotuneMessage('');
    }
  }, [getEngine]);

  // ── Vocal Fix Station ─────────────────────────────────────────────
  const [isVocalFixing, setIsVocalFixing] = useState(false);
  const [vocalFixProgress, setVocalFixProgress] = useState(0);
  const [vocalFixMessage, setVocalFixMessage] = useState('');
  const [vocalFixResult, setVocalFixResult] = useState<VocalFixResult | null>(null);
  const [vocalFixTrackName, setVocalFixTrackName] = useState('');

  const runVocalFix = useCallback(async (file: File) => {
    setIsVocalFixing(true);
    setVocalFixProgress(0);
    setVocalFixMessage('Decoding vocal...');
    setVocalFixResult(null);
    const trackName = file.name.replace(/\.[^.]+$/, '');
    setVocalFixTrackName(trackName);

    try {
      const engine = await getEngine();
      await engine.resume();
      const buffer = await engine.decodeFile(file);

      const result = await runVocalFixStation(buffer, (p, m) => {
        setVocalFixProgress(p);
        setVocalFixMessage(m);
      });

      const originalId = generateId();
      const fixedId = generateId();
      const fixBusId = defaultBusIdForStem('vocals');
      await engine.addStem(originalId, buffer, fixBusId);
      await engine.addStem(fixedId, result.buffer, fixBusId);

      const originalStem: Stem = {
        id: originalId,
        name: `${trackName} — Original`,
        type: 'vocals' as StemType,
        file: null,
        audioBuffer: buffer,
        processing: {
          ...defaultStemProcessing,
          eq: defaultStemProcessing.eq.map((b) => ({ ...b })),
          compressor: { ...defaultStemProcessing.compressor },
          saturation: { ...defaultStemProcessing.saturation },
          mute: true,
        },
        waveformData: ProAudioEngine.generateWaveformData(buffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId: fixBusId,
        sends: defaultSends(),
      };
      const fixedStem: Stem = {
        id: fixedId,
        name: `${trackName} — Vocal Fixed`,
        type: 'vocals' as StemType,
        file: null,
        audioBuffer: result.buffer,
        processing: { ...defaultStemProcessing },
        waveformData: ProAudioEngine.generateWaveformData(result.buffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId: fixBusId,
        sends: defaultSends(),
      };

      setClips((prev) => [
        ...prev,
        makeDefaultClip(originalId, buffer.duration),
        makeDefaultClip(fixedId, result.buffer.duration),
      ]);
      setStems((prev) => {
        const updated = [...prev, originalStem, fixedStem];
        let maxDuration = 0;
        updated.forEach((s) => {
          if (s.audioBuffer && s.audioBuffer.duration > maxDuration) maxDuration = s.audioBuffer.duration;
        });
        setTransport((t) => ({ ...t, duration: maxDuration }));
        return updated;
      });

      const origChannel = engine.stemChannels.get(originalId);
      if (origChannel) origChannel.updateProcessing({ ...originalStem.processing, mute: true }, false);
      setSelectedStemId(fixedId);
      setVocalFixResult(result);
      setVocalFixProgress(100);
      setVocalFixMessage('Vocal fix complete!');
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error('Vocal fix failed:', err);
      setVocalFixMessage('Failed — check the file format and try again.');
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      setIsVocalFixing(false);
      setVocalFixProgress(0);
      setVocalFixMessage('');
    }
  }, [getEngine]);

  // ── Beat Optimization Station ─────────────────────────────────────
  const [isBeatStation, setIsBeatStation] = useState(false);
  const [beatStationProgress, setBeatStationProgress] = useState(0);
  const [beatStationMessage, setBeatStationMessage] = useState('');
  const [beatStationNotes, setBeatStationNotes] = useState<string[] | null>(null);
  const [beatStationPreset, setBeatStationPreset] = useState('');
  const [beatStationTrackName, setBeatStationTrackName] = useState('');
  const [isOptimizingBeat, setIsOptimizingBeat] = useState(false);
  const [beatOptimizeProgress, setBeatOptimizeProgress] = useState(0);
  const [beatOptimizeMessage, setBeatOptimizeMessage] = useState('');
  const [beatAnalysis, setBeatAnalysis] = useState<BeatAnalysis | null>(null);

  const runBeatStation = useCallback(async (file: File) => {
    setIsBeatStation(true);
    setBeatStationProgress(0);
    setBeatStationMessage('Decoding beat...');
    setBeatStationNotes(null);
    setBeatStationPreset('');
    const trackName = file.name.replace(/\.[^.]+$/, '');
    setBeatStationTrackName(trackName);

    try {
      const engine = await getEngine();
      await engine.resume();
      const buffer = await engine.decodeFile(file);

      const result = await autoOptimizeBeat(buffer, (p, m) => {
        setBeatStationProgress(p);
        setBeatStationMessage(m);
      });

      setBeatAnalysis(result.analysis);
      setBeatStationPreset(result.presetName);
      setBeatStationNotes(result.notes);

      const originalId = generateId();
      const optimizedId = generateId();
      const drumsBusId = defaultBusIdForStem('drums');
      await engine.addStem(originalId, buffer, drumsBusId);
      await engine.addStem(optimizedId, result.buffer, drumsBusId);

      const originalStem: Stem = {
        id: originalId,
        name: `${trackName} — Original`,
        type: 'drums' as StemType,
        file: null,
        audioBuffer: buffer,
        processing: {
          ...defaultStemProcessing,
          eq: defaultStemProcessing.eq.map((b) => ({ ...b })),
          compressor: { ...defaultStemProcessing.compressor },
          saturation: { ...defaultStemProcessing.saturation },
          mute: true,
        },
        waveformData: ProAudioEngine.generateWaveformData(buffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId: drumsBusId,
        sends: defaultSends(),
      };
      const optimizedStem: Stem = {
        id: optimizedId,
        name: `${trackName} — Beat Optimized`,
        type: 'drums' as StemType,
        file: null,
        audioBuffer: result.buffer,
        processing: { ...defaultStemProcessing },
        waveformData: ProAudioEngine.generateWaveformData(result.buffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId: drumsBusId,
        sends: defaultSends(),
      };

      setClips((prev) => [
        ...prev,
        makeDefaultClip(originalId, buffer.duration),
        makeDefaultClip(optimizedId, result.buffer.duration),
      ]);
      setStems((prev) => {
        const updated = [...prev, originalStem, optimizedStem];
        let maxDuration = 0;
        updated.forEach((s) => {
          if (s.audioBuffer && s.audioBuffer.duration > maxDuration) maxDuration = s.audioBuffer.duration;
        });
        setTransport((t) => ({ ...t, duration: maxDuration }));
        return updated;
      });

      const origChannel = engine.stemChannels.get(originalId);
      if (origChannel) origChannel.updateProcessing({ ...originalStem.processing, mute: true }, false);
      setSelectedStemId(optimizedId);
      setBeatStationProgress(100);
      setBeatStationMessage('Beat station complete!');
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error('Beat station failed:', err);
      setBeatStationMessage('Failed — check the file format and try again.');
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      setIsBeatStation(false);
      setBeatStationProgress(0);
      setBeatStationMessage('');
    }
  }, [getEngine]);

  // ── Beat Optimizer (manual panel on selected stem) ─────────────────
  const runBeatOptimize = useCallback(async (stemId: string, settings: BeatOptimizeSettings) => {
    const stem = stems.find((s) => s.id === stemId);
    if (!stem?.audioBuffer) return;

    setIsOptimizingBeat(true);
    setBeatOptimizeProgress(0);
    setBeatOptimizeMessage('Starting beat optimization...');

    try {
      await new Promise((r) => setTimeout(r, 30));

      const result = await optimizeBeat(stem.audioBuffer, settings, (p, m) => {
        setBeatOptimizeProgress(p);
        setBeatOptimizeMessage(m);
      });

      setBeatAnalysis(result.analysis);

      // Replace the stem's audio buffer with the optimized version
      const engine = engineRef.current;
      if (engine) {
        engine.removeStem(stemId);
        const busId = stem.busId ?? defaultBusIdForStem(stem.type, stem.trackRole);
        await engine.addStem(stemId, result.buffer, busId);
        const channel = engine.stemChannels.get(stemId);
        if (channel) channel.updateProcessing(stem.processing, abBypass);
        if (stem.sends?.reverb) engine.setStemSend(stemId, 'reverb', stem.sends.reverb);
        if (stem.sends?.delay) engine.setStemSend(stemId, 'delay', stem.sends.delay);
      }

      const newWaveform = ProAudioEngine.generateWaveformData(result.buffer, 800);

      setStems((prev) =>
        prev.map((s) =>
          s.id === stemId
            ? { ...s, audioBuffer: result.buffer, waveformData: newWaveform }
            : s
        )
      );

      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.error('Beat optimization failed:', err);
      setBeatOptimizeMessage('Optimization failed.');
      await new Promise((r) => setTimeout(r, 1200));
    } finally {
      setIsOptimizingBeat(false);
      setBeatOptimizeProgress(0);
      setBeatOptimizeMessage('');
    }
  }, [stems, abBypass]);

  // Run analysis whenever selected stem changes (for the beat optimizer panel)
  useEffect(() => {
    if (!selectedStemId) { setBeatAnalysis(null); return; }
    const stem = stems.find((s) => s.id === selectedStemId);
    if (!stem?.audioBuffer) { setBeatAnalysis(null); return; }
    try {
      const a = analyzeBeat(stem.audioBuffer);
      setBeatAnalysis(a);
    } catch {
      setBeatAnalysis(null);
    }
  }, [selectedStemId, stems]);

  // Reset entire session — clears all stems, processing, and results
  const updateBus = useCallback((id: BusId, patch: Partial<BusState>) => {
    setBuses((prev) => {
      const next = prev.map((b) => (b.id === id ? { ...b, ...patch } : b));
      const engine = engineRef.current;
      const bus = next.find((b) => b.id === id);
      if (engine && bus) {
        if (patch.gain !== undefined) engine.setBusGain(id, bus.gain);
        if (patch.mute !== undefined) engine.setBusMute(id, bus.mute);
      }
      return next;
    });
  }, []);

  const updateStemSend = useCallback((stemId: string, fx: SendFxId, level: number) => {
    setStems((prev) =>
      prev.map((s) =>
        s.id === stemId
          ? { ...s, sends: { ...(s.sends ?? defaultSends()), [fx]: level } }
          : s
      )
    );
    engineRef.current?.setStemSend(stemId, fx, level);
  }, []);

  const setTrackRole = useCallback((stemId: string, role: TrackRole) => {
    setStems((prev) =>
      prev.map((s) => {
        if (s.id !== stemId) return s;
        const busId = defaultBusIdForStem(s.type, role);
        engineRef.current?.routeStemToBus(stemId, busId);
        return { ...s, trackRole: role, busId };
      })
    );
  }, []);

  const addClip = useCallback((clip: AudioClip) => {
    setClips((prev) => [...prev, clip]);
  }, []);

  const updateClip = useCallback((id: string, patch: Partial<AudioClip>) => {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const removeClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const splitClip = useCallback((clipId: string, time: number) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === clipId);
      if (!clip) return prev;
      if (time <= clip.startTime || time >= clip.startTime + clip.duration) return prev;
      const leftDur = time - clip.startTime;
      const rightDur = clip.duration - leftDur;
      const left: AudioClip = { ...clip, duration: leftDur, fadeOut: 0 };
      const right: AudioClip = {
        ...clip,
        id: generateId(),
        startTime: time,
        offset: clip.offset + leftDur,
        duration: rightDur,
        fadeIn: 0,
      };
      return [...prev.filter((c) => c.id !== clipId), left, right];
    });
  }, []);

  const setSongSections = useCallback((next: SongSection[]) => {
    setSections(next);
  }, []);

  const addSection = useCallback((section: SongSection) => {
    setSections((prev) => [...prev, section]);
  }, []);

  const removeSection = useCallback((id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const appendProcessedPair = useCallback(
    async (
      engine: ProAudioEngine,
      trackName: string,
      type: StemType,
      originalBuffer: AudioBuffer,
      processedBuffer: AudioBuffer,
      processedLabel: string
    ) => {
      const originalId = generateId();
      const processedId = generateId();
      const busId = defaultBusIdForStem(type);
      await engine.addStem(originalId, originalBuffer, busId);
      await engine.addStem(processedId, processedBuffer, busId);

      const originalStem: Stem = {
        id: originalId,
        name: `${trackName} — Original`,
        type,
        file: null,
        audioBuffer: originalBuffer,
        processing: { ...cloneStemProcessing(), mute: true },
        waveformData: ProAudioEngine.generateWaveformData(originalBuffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId,
        sends: defaultSends(),
      };
      const processedStem: Stem = {
        id: processedId,
        name: `${trackName} — ${processedLabel}`,
        type,
        file: null,
        audioBuffer: processedBuffer,
        processing: cloneStemProcessing(),
        waveformData: ProAudioEngine.generateWaveformData(processedBuffer, 800),
        peakLevel: 0,
        rmsLevel: 0,
        busId,
        sends: defaultSends(),
      };

      setClips((prev) => [
        ...prev,
        makeDefaultClip(originalId, originalBuffer.duration),
        makeDefaultClip(processedId, processedBuffer.duration),
      ]);
      setStems((prev) => {
        const updated = [...prev, originalStem, processedStem];
        let maxDuration = 0;
        updated.forEach((s) => {
          if (s.audioBuffer && s.audioBuffer.duration > maxDuration) maxDuration = s.audioBuffer.duration;
        });
        setTransport((t) => ({ ...t, duration: maxDuration }));
        return updated;
      });

      const origChannel = engine.stemChannels.get(originalId);
      if (origChannel) origChannel.updateProcessing({ ...originalStem.processing, mute: true }, false);
      setSelectedStemId(processedId);
      return { originalId, processedId };
    },
    []
  );

  const runRepair = useCallback(async (file: File) => {
    setIsRepairing(true);
    setRepairProgress(0);
    setRepairMessage('Decoding audio...');
    setRepairResult(null);
    const trackName = file.name.replace(/\.[^.]+$/, '');
    setRepairTrackName(trackName);

    try {
      const engine = await getEngine();
      await engine.resume();
      const buffer = await engine.decodeFile(file);

      const result = await runAudioRepair(buffer, defaultRepairSettings, (p, m) => {
        setRepairProgress(p);
        setRepairMessage(m);
      });

      await appendProcessedPair(
        engine,
        trackName,
        'fullmix',
        buffer,
        result.buffer,
        'Repaired'
      );
      // Route repair stems to music bus (appendProcessedPair already uses defaultBusIdForStem)
      setRepairResult(result);
      setRepairProgress(100);
      setRepairMessage('Repair complete!');
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error('Audio repair failed:', err);
      setRepairMessage('Failed — check the file format and try again.');
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      setIsRepairing(false);
      setRepairProgress(0);
      setRepairMessage('');
    }
  }, [getEngine, appendProcessedPair]);

  // ── Assembly Line ───────────────────────────────────────────────
  const [isAssemblyLine, setIsAssemblyLine] = useState(false);
  const [assemblyProgress, setAssemblyProgress] = useState(0);
  const [assemblyMessage, setAssemblyMessage] = useState('');
  const [assemblyStage, setAssemblyStage] = useState('');
  const [assemblyResult, setAssemblyResult] = useState<AssemblyLineReportData | null>(null);
  const [assemblyTrackName, setAssemblyTrackName] = useState('');
  const assemblyAbortRef = useRef<AbortController | null>(null);
  const assemblyProgressFlushRef = useRef<number | null>(null);
  const assemblyProgressPendingRef = useRef<{ pct: number; stage: string; message: string } | null>(null);

  const cancelAssemblyLine = useCallback(() => {
    assemblyAbortRef.current?.abort();
  }, []);

  const flushAssemblyProgress = useCallback(() => {
    assemblyProgressFlushRef.current = null;
    const pending = assemblyProgressPendingRef.current;
    if (!pending) return;
    setAssemblyProgress(pending.pct);
    setAssemblyStage(pending.stage);
    setAssemblyMessage(pending.message);
  }, []);

  const runAssemblyLineStation = useCallback(async (file: File) => {
    assemblyAbortRef.current?.abort();
    const ac = new AbortController();
    assemblyAbortRef.current = ac;

    setIsAssemblyLine(true);
    setAssemblyProgress(0);
    setAssemblyMessage('Decoding audio...');
    setAssemblyStage(ASSEMBLY_STAGE_LABELS.analyze);
    setAssemblyResult(null);
    const trackName = file.name.replace(/\.[^.]+$/, '');
    setAssemblyTrackName(trackName);

    try {
      const engine = await getEngine();
      await engine.resume();
      // Let UI paint before heavy decode/DSP
      await new Promise((r) => setTimeout(r, 50));
      const buffer = await engine.decodeFile(file);
      await new Promise((r) => setTimeout(r, 0));

      const result = await runAssemblyLine(buffer, {
        trackName,
        signal: ac.signal,
        onProgress: (pct, stageId: AssemblyStageId, message) => {
          assemblyProgressPendingRef.current = {
            pct,
            stage: ASSEMBLY_STAGE_LABELS[stageId],
            message,
          };
          if (assemblyProgressFlushRef.current == null) {
            assemblyProgressFlushRef.current = window.setTimeout(flushAssemblyProgress, 80);
          }
        },
      });

      if (ac.signal.aborted) {
        const err = new Error('cancelled');
        err.name = 'AbortError';
        throw err;
      }

      flushAssemblyProgress();

      const { processedId } = await appendProcessedPair(
        engine,
        trackName,
        'fullmix',
        result.originalBuffer,
        result.finalBuffer,
        'Final'
      );

      setSections(result.report.sections);
      setBeatAnalysis(result.report.diagnosis.beat);
      // Store report only — never put AudioBuffers into React state
      setAssemblyResult(result.report);
      setSelectedStemId(processedId);

      // ── Auto-deliver: download mastered file without switching bays ──
      setAssemblyStage(ASSEMBLY_STAGE_LABELS.deliver);
      setAssemblyMessage('Exporting mastered MP3...');
      setAssemblyProgress(96);
      try {
        const finalStem: Stem = {
          id: processedId,
          name: `${trackName} — Final`,
          type: 'fullmix',
          file: null,
          audioBuffer: result.finalBuffer,
          processing: cloneStemProcessing(),
          waveformData: [],
          peakLevel: 0,
          rmsLevel: 0,
          busId: defaultBusIdForStem('fullmix'),
          sends: defaultSends(),
        };
        const blob = await engine.exportMP3(
          [finalStem],
          defaultMasterProcessing,
          result.finalBuffer.duration,
          320,
          (p) => {
            setAssemblyProgress(96 + Math.round(p * 0.03));
            setAssemblyMessage(`Exporting mastered MP3... ${Math.round(p)}%`);
          }
        );
        downloadBlob(blob, `${trackName}-mastered-320kbps.mp3`);
        setAssemblyMessage('Downloaded · starting playback...');
      } catch (exportErr) {
        console.warn('Auto MP3 export failed, falling back to WAV:', exportErr);
        try {
          const finalStem: Stem = {
            id: processedId,
            name: `${trackName} — Final`,
            type: 'fullmix',
            file: null,
            audioBuffer: result.finalBuffer,
            processing: cloneStemProcessing(),
            waveformData: [],
            peakLevel: 0,
            rmsLevel: 0,
            busId: defaultBusIdForStem('fullmix'),
            sends: defaultSends(),
          };
          const wavBlob = await engine.exportStem(
            finalStem,
            defaultMasterProcessing,
            result.finalBuffer.duration,
            24,
            'noise-shaped'
          );
          downloadBlob(wavBlob, `${trackName}-mastered.wav`);
          setAssemblyMessage('Downloaded WAV · starting playback...');
        } catch (wavErr) {
          console.error('Auto export failed:', wavErr);
          setAssemblyMessage('Master ready — use Export panel to download.');
        }
      }

      // Auto-play the finished master
      try {
        engine.stop();
        engine.play(0);
        setTransport((prev) => ({ ...prev, isPlaying: true, currentTime: 0 }));
      } catch {
        /* playback may require a gesture on some browsers — download still works */
      }

      setAssemblyProgress(100);
      setAssemblyMessage('Assembly complete — file downloaded & playing!');
      setAssemblyStage(ASSEMBLY_STAGE_LABELS.done);
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err: unknown) {
      const name = err && typeof err === 'object' && 'name' in err ? (err as { name: string }).name : '';
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Unknown error';
      if (name === 'AbortError') {
        setAssemblyMessage('Cancelled.');
      } else {
        console.error('Assembly line failed:', err);
        setAssemblyMessage(`Failed: ${message}`);
      }
      // Keep failure visible in the report panel
      setAssemblyResult((prev) =>
        prev ?? {
          sections: [],
          diagnosis: {
            bpm: 0,
            duration: 0,
            peakDb: -Infinity,
            rmsDb: -Infinity,
            estimatedLufs: -Infinity,
            crestFactor: 0,
            stereoImbalanceDb: 0,
            mudRatio: 0,
            harshRatio: 0,
            issues: [],
            sectionFlags: [],
            beat: {
              bpm: 0,
              confidence: 0,
              kickCount: 0,
              snareCount: 0,
              hatCount: 0,
              totalHits: 0,
              averageVelocity: 0,
              grooveTightness: 0,
            },
            repairSettings: {
              denoise: 0,
              declick: 0,
              dehum: 0,
              humFreq: 60,
              deplosive: 0,
              declip: 0,
              dereverb: 0,
            },
            notes: [name === 'AbortError' ? 'Cancelled.' : message],
          },
          stageNotes: [
            {
              stage: 'done',
              label: 'Done',
              notes: [name === 'AbortError' ? 'Cancelled by user.' : `Failed: ${message}`],
            },
          ],
          trackAnalysisNotes: [],
          finalLUFS: 0,
          truePeak: 0,
          bpm: 0,
          sectionCount: 0,
        }
      );
      await new Promise((r) => setTimeout(r, 2500));
    } finally {
      if (assemblyProgressFlushRef.current != null) {
        clearTimeout(assemblyProgressFlushRef.current);
        assemblyProgressFlushRef.current = null;
      }
      setIsAssemblyLine(false);
      setAssemblyProgress(0);
      setAssemblyMessage('');
      setAssemblyStage('');
      if (assemblyAbortRef.current === ac) assemblyAbortRef.current = null;
    }
  }, [getEngine, appendProcessedPair, flushAssemblyProgress]);

  const clearRecordPoll = useCallback(() => {
    if (recordPollRef.current) {
      clearInterval(recordPollRef.current);
      recordPollRef.current = null;
    }
  }, []);

  const armRecorder = useCallback(async () => {
    const rec = micRecorderRef.current ?? new MicRecorder();
    micRecorderRef.current = rec;
    await rec.arm();
    setIsArmed(true);
    clearRecordPoll();
    recordPollRef.current = setInterval(() => {
      setInputPeak(micRecorderRef.current?.inputPeak ?? 0);
      if (micRecorderRef.current?.isRecording) {
        setRecordElapsed(micRecorderRef.current.getElapsed());
      }
    }, 50);
  }, [clearRecordPoll]);

  const disarmRecorder = useCallback(() => {
    clearRecordPoll();
    metronomeSrcRef.current.forEach((s) => {
      try { s.stop(); } catch { /* */ }
    });
    metronomeSrcRef.current = [];
    micRecorderRef.current?.disarm();
    micRecorderRef.current = null;
    setIsArmed(false);
    setIsRecording(false);
    setInputPeak(0);
    setRecordElapsed(0);
  }, [clearRecordPoll]);

  const startRecording = useCallback(async () => {
    const rec = micRecorderRef.current;
    if (!rec) return;
    rec.start();
    setIsRecording(true);
    setRecordElapsed(0);

    if (metronomeEnabled) {
      try {
        const engine = await getEngine();
        await engine.resume();
        const click = createClickBuffer(engine.context);
        const bpm = 120;
        const interval = 60 / bpm;
        const startAt = engine.context.currentTime + 0.05;
        for (let i = 0; i < 64; i++) {
          const src = engine.context.createBufferSource();
          src.buffer = click;
          src.connect(engine.context.destination);
          src.start(startAt + i * interval);
          metronomeSrcRef.current.push(src);
        }
      } catch {
        // skip metronome quietly
      }
    }
  }, [metronomeEnabled, getEngine]);

  const stopRecording = useCallback(async () => {
    const rec = micRecorderRef.current;
    if (!rec) return;
    const buffer = rec.stop();
    setIsRecording(false);
    metronomeSrcRef.current.forEach((s) => {
      try { s.stop(); } catch { /* */ }
    });
    metronomeSrcRef.current = [];

    const engine = await getEngine();
    await engine.resume();
    const id = generateId();
    const busId = defaultBusIdForStem('vocals');
    const playhead = transportLoopRef.current.currentTime || 0;
    await engine.addStem(id, buffer, busId);

    const stem: Stem = {
      id,
      name: `Take ${new Date().toLocaleTimeString()}`,
      type: 'vocals',
      file: null,
      audioBuffer: buffer,
      processing: cloneStemProcessing(),
      waveformData: ProAudioEngine.generateWaveformData(buffer, 800),
      peakLevel: 0,
      rmsLevel: 0,
      busId,
      sends: defaultSends(),
    };
    setClips((prev) => [...prev, makeDefaultClip(id, buffer.duration, playhead)]);
    setStems((prev) => {
      const updated = [...prev, stem];
      let maxDuration = playhead + buffer.duration;
      updated.forEach((s) => {
        if (s.audioBuffer) maxDuration = Math.max(maxDuration, s.audioBuffer.duration);
      });
      setTransport((t) => ({ ...t, duration: Math.max(t.duration, maxDuration) }));
      return updated;
    });
    setSelectedStemId(id);
    setRecordElapsed(0);
  }, [getEngine]);

  const swapStationAB = useCallback((processedId: string) => {
    setStems((prev) => {
      const processed = prev.find((s) => s.id === processedId);
      if (!processed) return prev;
      const base = stemBaseName(processed.name);
      const original = prev.find(
        (s) =>
          s.id !== processedId &&
          stemBaseName(s.name) === base &&
          /original/i.test(s.name)
      );
      const processedMuted = !!processed.processing.mute;

      return prev.map((s) => {
        if (original) {
          if (s.id === processedId) {
            return { ...s, processing: { ...s.processing, mute: !processedMuted } };
          }
          if (s.id === original.id) {
            return { ...s, processing: { ...s.processing, mute: processedMuted } };
          }
          return s;
        }
        if (stemBaseName(s.name) === base) {
          return { ...s, processing: { ...s.processing, mute: !s.processing.mute } };
        }
        return s;
      });
    });
  }, []);

  const resetSession = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      for (const stem of stems) {
        engine.removeStem(stem.id);
      }
    }
    setStems([]);
    setClips([]);
    setSections([]);
    setBuses(createDefaultBuses());
    setMetadata({ ...defaultDeliveryMetadata });
    setVideoOffsetMs(0);
    setBounceMode('fullmix');
    setRepairResult(null);
    setAssemblyResult(null);
    setSelectedStemId(null);
    setMasterProcessing(defaultMasterProcessing);
    setTransport({ isPlaying: false, currentTime: 0, duration: 0, loop: false, loopStart: 0, loopEnd: 0 });
    setQuickMasterResult(null);
    setQuickMasterProgress(0);
    setQuickMasterMessage('');
    setAutoMixAnalysis(null);
    setAutoLevelResult(null);
    setAutotuneResult(null);
    setVocalFixResult(null);
    setBeatStationNotes(null);
    setBeatStationPreset('');
    setBeatAnalysis(null);
    setActivePresetId(null);
    setMarkers([]);
    setRegions([]);
    setHistory([]);
    setHistoryIndex(-1);
    disarmRecorder();
  }, [stems, disarmRecorder]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (recordPollRef.current) clearInterval(recordPollRef.current);
      if (engineRef.current) engineRef.current.destroy();
    };
  }, []);

  return {
    stems,
    masterProcessing,
    transport,
    abBypass,
    selectedStemId,
    activePresetId,
    masterMeter,
    proMeter,
    spectrumData,
    stemMeters,
    isExporting,
    exportProgress,
    exportBitDepth,
    exportDither,
    exportFormat,
    setExportFormat,
    engineReady,
    workletsAvailable,
    addStems,
    removeStem,
    updateStemProcessing,
    updateMasterProcessing,
    setSelectedStemId,
    setExportBitDepth,
    setExportDither,
    play,
    pause,
    stop,
    rewind,
    seek,
    toggleLoop,
    setLoopFromRegion,
    toggleABBypass,
    applyPreset,
    exportWAV,
    exportMP3,
    exportFLAC,
    exportStemFile,
    exportAllStems,
    doExport,
    bounceDelivery,
    setDeliveryMetadata,
    setBounceMode,
    bounceMode,
    metadata,
    saveSession,
    loadSession,
    loudnessOffset,
    pushHistory,
    undo,
    redo,
    historyIndex,
    historyLength: history.length,
    sidechainRoutes,
    connectSidechain,
    disconnectSidechain,
    updateSidechainParams,
    automationLanes,
    setAutomationLanes,
    updateTransientParams,
    updateGateParams,
    markers,
    regions,
    addMarker,
    removeMarker,
    addRegion,
    removeRegion,
    reorderStems,
    duplicateStem,
    buses,
    clips,
    sections,
    videoOffsetMs,
    setVideoOffsetMs,
    snapEnabled,
    setSnapEnabled,
    updateBus,
    updateStemSend,
    setTrackRole,
    addClip,
    updateClip,
    removeClip,
    splitClip,
    setSongSections,
    addSection,
    removeSection,
    isRepairing,
    repairProgress,
    repairMessage,
    repairResult,
    repairTrackName,
    runRepair,
    setRepairResult,
    isAssemblyLine,
    assemblyProgress,
    assemblyMessage,
    assemblyStage,
    assemblyResult,
    assemblyTrackName,
    runAssemblyLine: runAssemblyLineStation,
    cancelAssemblyLine,
    setAssemblyResult,
    isArmed,
    isRecording,
    inputPeak,
    recordElapsed,
    metronomeEnabled,
    setMetronomeEnabled,
    armRecorder,
    disarmRecorder,
    startRecording,
    stopRecording,
    swapStationAB,
    isQuickMastering,
    quickMasterProgress,
    quickMasterMessage,
    quickMasterResult,
    quickMasterTrackName,
    runQuickMaster,
    setQuickMasterResult,
    isAutoMixing,
    autoMixProgress,
    autoMixMessage,
    autoMixAnalysis,
    runAutoMix,
    isAutoLeveling,
    autoLevelProgress,
    autoLevelMessage,
    autoLevelResult,
    autoLevelTrackName,
    runAutoLevel,
    setAutoLevelResult,
    isAutotuning,
    autotuneProgress,
    autotuneMessage,
    autotuneResult,
    autotuneTrackName,
    runAutotune,
    setAutotuneResult,
    isVocalFixing,
    vocalFixProgress,
    vocalFixMessage,
    vocalFixResult,
    vocalFixTrackName,
    runVocalFix,
    setVocalFixResult,
    isBeatStation,
    beatStationProgress,
    beatStationMessage,
    beatStationNotes,
    beatStationPreset,
    beatStationTrackName,
    runBeatStation,
    setBeatStationNotes,
    isOptimizingBeat,
    beatOptimizeProgress,
    beatOptimizeMessage,
    beatAnalysis,
    runBeatOptimize,
    resetSession,
  };
}
