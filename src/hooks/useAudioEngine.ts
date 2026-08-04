'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { AudioEngine } from '@/lib/audio-engine';
import {
  Stem,
  StemType,
  StemProcessing,
  MasterProcessing,
  MeterData,
  TransportState,
  Preset,
} from '@/types/audio';
import {
  defaultStemProcessing,
  defaultMasterProcessing,
  defaultTransport,
  defaultMeterData,
} from '@/lib/defaults';
import { generateId } from '@/lib/utils';

export function useAudioEngine() {
  const engineRef = useRef<AudioEngine | null>(null);
  const animFrameRef = useRef<number>(0);

  const [stems, setStems] = useState<Stem[]>([]);
  const [masterProcessing, setMasterProcessing] = useState<MasterProcessing>(defaultMasterProcessing);
  const [transport, setTransport] = useState<TransportState>(defaultTransport);
  const [abBypass, setAbBypass] = useState(false);
  const [selectedStemId, setSelectedStemId] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [masterMeter, setMasterMeter] = useState<MeterData>(defaultMeterData);
  const [spectrumData, setSpectrumData] = useState<Float32Array | null>(null);
  const [stemMeters, setStemMeters] = useState<Record<string, number>>({});
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Initialize engine
  const getEngine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine();
    }
    return engineRef.current;
  }, []);

  // Animation loop for meters
  const startMetering = useCallback(() => {
    const update = () => {
      const engine = engineRef.current;
      if (!engine) return;

      if (engine.getIsPlaying()) {
        // Master meters
        const meterData = engine.masterChannel.getMeterData();
        setMasterMeter(meterData);

        // Spectrum
        const spectrum = engine.masterChannel.getSpectrumData();
        setSpectrumData(new Float32Array(spectrum));

        // Transport time
        setTransport((prev) => ({
          ...prev,
          currentTime: engine.getCurrentTime(),
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
      const engine = getEngine();
      await engine.resume();

      const newStems: Stem[] = [];
      for (const { file, type } of files) {
        try {
          const buffer = await engine.decodeFile(file);
          const id = generateId();

          engine.addStem(id, buffer);

          const waveformData = AudioEngine.generateWaveformData(buffer, 800);

          const stem: Stem = {
            id,
            name: file.name.replace(/\.[^.]+$/, ''),
            type,
            file,
            audioBuffer: buffer,
            processing: { ...defaultStemProcessing, eq: [...defaultStemProcessing.eq.map(b => ({...b}))] },
            waveformData,
            peakLevel: 0,
            rmsLevel: 0,
          };

          newStems.push(stem);
        } catch (err) {
          console.error(`Failed to decode ${file.name}:`, err);
        }
      }

      setStems((prev) => {
        const updated = [...prev, ...newStems];
        // Update duration
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

  // Remove stem
  const removeStem = useCallback(
    (id: string) => {
      const engine = engineRef.current;
      if (engine) {
        engine.removeStem(id);
      }
      setStems((prev) => prev.filter((s) => s.id !== id));
      if (selectedStemId === id) {
        setSelectedStemId(null);
      }
    },
    [selectedStemId]
  );

  // Update stem processing
  const updateStemProcessing = useCallback(
    (id: string, updates: Partial<StemProcessing>) => {
      setStems((prev) =>
        prev.map((stem) => {
          if (stem.id !== id) return stem;
          const newProcessing = { ...stem.processing, ...updates };

          // Apply to engine
          const engine = engineRef.current;
          const channel = engine?.stemChannels.get(id);
          if (channel) {
            channel.updateProcessing(newProcessing, abBypass);
          }

          return { ...stem, processing: newProcessing };
        })
      );
    },
    [abBypass]
  );

  // Update master processing
  const updateMasterProcessing = useCallback(
    (updates: Partial<MasterProcessing>) => {
      setMasterProcessing((prev) => {
        const newProcessing = { ...prev, ...updates };
        const engine = engineRef.current;
        if (engine) {
          engine.masterChannel.updateProcessing(newProcessing, abBypass);
        }
        return newProcessing;
      });
    },
    [abBypass]
  );

  // Sync all processing to engine
  const syncAllProcessing = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    // Handle solo: if any stem is soloed, mute all non-soloed stems
    const anySolo = stems.some((s) => s.processing.solo);

    stems.forEach((stem) => {
      const channel = engine.stemChannels.get(stem.id);
      if (channel) {
        const effectiveProcessing = { ...stem.processing };
        if (anySolo && !stem.processing.solo) {
          effectiveProcessing.mute = true;
        }
        channel.updateProcessing(effectiveProcessing, abBypass);
      }
    });

    engine.masterChannel.updateProcessing(masterProcessing, abBypass);
  }, [stems, masterProcessing, abBypass]);

  useEffect(() => {
    syncAllProcessing();
  }, [syncAllProcessing]);

  // Transport controls
  const play = useCallback(() => {
    const engine = getEngine();
    engine.play();
    setTransport((prev) => ({ ...prev, isPlaying: true }));
  }, [getEngine]);

  const pause = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      engine.pause();
    }
    setTransport((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      engine.stop();
    }
    setTransport((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
    setMasterMeter(defaultMeterData);
    setSpectrumData(null);
  }, []);

  const rewind = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      const wasPlaying = engine.getIsPlaying();
      engine.stop();
      if (wasPlaying) {
        engine.play(0);
      }
    }
    setTransport((prev) => ({ ...prev, currentTime: 0 }));
  }, []);

  const seek = useCallback(
    (time: number) => {
      const engine = engineRef.current;
      if (engine) {
        const wasPlaying = engine.getIsPlaying();
        engine.stop();
        if (wasPlaying) {
          engine.play(time);
        }
      }
      setTransport((prev) => ({ ...prev, currentTime: time }));
    },
    []
  );

  const toggleLoop = useCallback(() => {
    setTransport((prev) => ({ ...prev, loop: !prev.loop }));
  }, []);

  const toggleABBypass = useCallback(() => {
    setAbBypass((prev) => !prev);
  }, []);

  // Apply preset
  const applyPreset = useCallback(
    (preset: Preset) => {
      setActivePresetId(preset.id);

      // Apply stem settings
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

      // Apply master settings
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
    },
    []
  );

  // Export
  const exportWAV = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || stems.length === 0) return;

    setIsExporting(true);
    setExportProgress(0);

    try {
      const blob = await engine.exportWAV(
        stems,
        masterProcessing,
        transport.duration,
        setExportProgress
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mix-export.wav';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [stems, masterProcessing, transport.duration]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
      }
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
    spectrumData,
    stemMeters,
    isExporting,
    exportProgress,
    addStems,
    removeStem,
    updateStemProcessing,
    updateMasterProcessing,
    setSelectedStemId,
    play,
    pause,
    stop,
    rewind,
    seek,
    toggleLoop,
    toggleABBypass,
    applyPreset,
    exportWAV,
  };
}
