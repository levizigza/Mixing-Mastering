'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Upload,
  Music,
  Mic,
  Drum,
  Guitar,
  Waves,
  Wand2,
  SlidersHorizontal,
  Gauge,
  Volume2,
  AudioLines,
  Mic2,
  Wrench,
  Package,
  Factory,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StemType } from '@/types/audio';
import { LevelingMode } from '@/lib/audio-leveler';
import { AUTOTUNE_PRESETS, intensityToLabel } from '@/lib/autotune-station';
import { STATION_ORDER, STATION_THEMES, StationId } from '@/lib/station-theme';

type UploadMode = StationId;

interface AudioUploadProps {
  onFilesSelected: (files: { file: File; type: StemType }[]) => void;
  onQuickMaster?: (file: File) => void;
  onAutoMix?: () => void;
  onAutoLevel?: (file: File, mode: LevelingMode) => void;
  onBeatStation?: (file: File) => void;
  onAutotune?: (file: File, intensity: number) => void;
  onVocalFix?: (file: File) => void;
  onRepair?: (file: File) => void;
  onAssemblyLine?: (file: File, opts?: { hitMaker?: boolean; studioTune?: boolean }) => void;
  onCancelAssemblyLine?: () => void;
  onStationChange?: (station: StationId) => void;
  existingStems: string[];
  isQuickMastering?: boolean;
  quickMasterProgress?: number;
  quickMasterMessage?: string;
  isAutoMixing?: boolean;
  autoMixProgress?: number;
  autoMixMessage?: string;
  isAutoLeveling?: boolean;
  autoLevelProgress?: number;
  autoLevelMessage?: string;
  isBeatStation?: boolean;
  beatStationProgress?: number;
  beatStationMessage?: string;
  isAutotuning?: boolean;
  autotuneProgress?: number;
  autotuneMessage?: string;
  isVocalFixing?: boolean;
  vocalFixProgress?: number;
  vocalFixMessage?: string;
  isRepairing?: boolean;
  repairProgress?: number;
  repairMessage?: string;
  isAssemblyLine?: boolean;
  assemblyProgress?: number;
  assemblyMessage?: string;
  assemblyStage?: string;
}

const STEM_ICONS: Record<StemType, React.ReactNode> = {
  vocals: <Mic size={14} />,
  drums: <Drum size={14} />,
  bass: <Guitar size={14} />,
  instruments: <Music size={14} />,
  fx: <Waves size={14} />,
  fullmix: <Music size={14} />,
};

const stemConfig: { type: StemType; label: string; color: string }[] = [
  { type: 'vocals', label: 'Vocals', color: '#818cf8' },
  { type: 'drums', label: 'Drums', color: '#fb923c' },
  { type: 'bass', label: 'Bass', color: '#4ade80' },
  { type: 'instruments', label: 'Inst', color: '#facc15' },
  { type: 'fx', label: 'FX', color: '#22d3ee' },
];

const STATION_ICONS: Record<StationId, React.ReactNode> = {
  assembly: <Factory size={14} />,
  automaster: <Wand2 size={14} />,
  automix: <SlidersHorizontal size={14} />,
  autolevel: <Gauge size={14} />,
  beat: <Drum size={14} />,
  autotune: <AudioLines size={14} />,
  vocalfix: <Mic2 size={14} />,
  repair: <Wrench size={14} />,
  delivery: <Package size={14} />,
};

function isAudioFile(f: File): boolean {
  if (f.type && f.type.startsWith('audio/')) return true;
  return /\.(mp3|wav|wave|flac|m4a|aac|ogg|opus|aiff?|wma)$/i.test(f.name);
}

function ProgressBlock({
  color,
  icon,
  label,
  progress,
  message,
}: {
  color: string;
  icon: React.ReactNode;
  label: string;
  progress?: number;
  message?: string;
}) {
  return (
    <div className="space-y-2.5 px-1">
      <div className="flex items-center gap-2">
        <span className="studio-led studio-led-on" style={{ color, background: color }} />
        <span className="text-[11px] font-mono font-semibold uppercase tracking-wide" style={{ color }}>
          {label}
        </span>
        <span className="ml-auto text-[10px] font-mono tabular-nums text-studio-muted">
          {Math.round(progress ?? 0)}%
        </span>
      </div>
      <div className="relative h-2 rounded-sm overflow-hidden bg-black/50 border border-white/5">
        <div
          className="absolute inset-y-0 left-0 transition-all duration-300"
          style={{
            width: `${progress ?? 0}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            boxShadow: `0 0 12px ${color}`,
          }}
        />
      </div>
      <p className="text-[10px] text-studio-muted font-mono text-center">{message || 'Processing...'}</p>
      <span className="sr-only">{icon}</span>
    </div>
  );
}

function DropZone({
  dragOver,
  setDragOver,
  onDrop,
  onFileInput,
  color,
  icon,
  title,
  subtitle,
  multiple,
}: {
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  color: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  multiple?: boolean;
}) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      className={cn(
        'relative flex flex-col items-center justify-center gap-2 p-5 rounded-md border border-dashed transition-all cursor-pointer',
        dragOver ? 'scale-[1.01]' : 'bg-black/25'
      )}
      style={{
        borderColor: dragOver ? color : 'rgba(255,255,255,0.12)',
        background: dragOver ? `color-mix(in srgb, ${color} 14%, transparent)` : undefined,
        boxShadow: dragOver ? `inset 0 0 24px ${color}22` : undefined,
      }}
    >
      <input
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac"
        multiple={multiple}
        onChange={onFileInput}
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
      <div
        className="w-11 h-11 rounded-md flex items-center justify-center border"
        style={{
          borderColor: `${color}55`,
          background: `color-mix(in srgb, ${color} 12%, #121218)`,
          color,
        }}
      >
        {icon}
      </div>
      <p className="text-[11px] text-studio-text text-center font-medium">{title}</p>
      <p className="text-[9px] text-studio-muted font-mono text-center">{subtitle}</p>
    </div>
  );
}

export default function AudioUpload({
  onFilesSelected,
  onQuickMaster,
  onAutoMix,
  onAutoLevel,
  onBeatStation,
  onAutotune,
  onVocalFix,
  onRepair,
  onAssemblyLine,
  onCancelAssemblyLine,
  onStationChange,
  existingStems,
  isQuickMastering,
  quickMasterProgress,
  quickMasterMessage,
  isAutoMixing,
  autoMixProgress,
  autoMixMessage,
  isAutoLeveling,
  autoLevelProgress,
  autoLevelMessage,
  isBeatStation,
  beatStationProgress,
  beatStationMessage,
  isAutotuning,
  autotuneProgress,
  autotuneMessage,
  isVocalFixing,
  vocalFixProgress,
  vocalFixMessage,
  isRepairing,
  repairProgress,
  repairMessage,
  isAssemblyLine,
  assemblyProgress,
  assemblyMessage,
  assemblyStage,
}: AudioUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [assemblyDragOver, setAssemblyDragOver] = useState(false);
  const [assemblyFile, setAssemblyFile] = useState<File | null>(null);
  const [hitMakerEnabled, setHitMakerEnabled] = useState(true);
  const [studioTuneEnabled, setStudioTuneEnabled] = useState(true);
  const [selectedType, setSelectedType] = useState<StemType>('vocals');
  const [mode, setMode] = useState<UploadMode>('assembly');
  const [showManualStations, setShowManualStations] = useState(false);
  const [levelMode, setLevelMode] = useState<LevelingMode>(() => {
    if (typeof window === 'undefined') return 'mix';
    try {
      const raw = localStorage.getItem('station-presets');
      if (raw) {
        const p = JSON.parse(raw);
        if (p.levelMode === 'mix' || p.levelMode === 'loudness' || p.levelMode === 'peak') return p.levelMode;
      }
    } catch { /* */ }
    return 'mix';
  });
  const [autotuneIntensity, setAutotuneIntensity] = useState(() => {
    if (typeof window === 'undefined') return 35;
    try {
      const raw = localStorage.getItem('station-presets');
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.autotuneIntensity === 'number') return p.autotuneIntensity;
      }
    } catch { /* */ }
    return 35;
  });

  const theme = STATION_THEMES[mode];
  const assemblyTheme = STATION_THEMES.assembly;

  useEffect(() => {
    onStationChange?.(mode);
  }, [mode, onStationChange]);

  useEffect(() => {
    try {
      localStorage.setItem(
        'station-presets',
        JSON.stringify({ levelMode, autotuneIntensity })
      );
    } catch { /* */ }
  }, [levelMode, autotuneIntensity]);

  const selectStation = (id: StationId) => {
    setMode(id);
    setDragOver(false);
    if (id !== 'assembly') setShowManualStations(true);
  };

  const queueAssemblyFile = useCallback((files: File[]) => {
    const audio = files.find(isAudioFile);
    if (!audio) return;
    setAssemblyFile(audio);
    setMode('assembly');
  }, []);

  const handleAssemblyDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setAssemblyDragOver(false);
      queueAssemblyFile(Array.from(e.dataTransfer.files));
    },
    [queueAssemblyFile]
  );

  const handleAssemblyFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      queueAssemblyFile(Array.from(e.target.files || []));
      e.target.value = '';
    },
    [queueAssemblyFile]
  );

  const startAssemblyLine = useCallback(() => {
    if (!assemblyFile || !onAssemblyLine || isAssemblyLine) return;
    onAssemblyLine(assemblyFile, {
      hitMaker: hitMakerEnabled,
      studioTune: studioTuneEnabled,
    });
  }, [assemblyFile, onAssemblyLine, isAssemblyLine, hitMakerEnabled, studioTuneEnabled]);

  const clearAssemblyFile = useCallback(() => {
    setAssemblyFile(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter(isAudioFile);
      if (files.length === 0) return;

      if (mode === 'automaster' && onQuickMaster) onQuickMaster(files[0]);
      else if (mode === 'assembly' && onAssemblyLine) onAssemblyLine(files[0]);
      else if (mode === 'autolevel' && onAutoLevel) onAutoLevel(files[0], levelMode);
      else if (mode === 'beat' && onBeatStation) onBeatStation(files[0]);
      else if (mode === 'autotune' && onAutotune) onAutotune(files[0], autotuneIntensity);
      else if (mode === 'vocalfix' && onVocalFix) onVocalFix(files[0]);
      else if (mode === 'repair' && onRepair) onRepair(files[0]);
      else if (mode === 'delivery') return;
      else onFilesSelected(files.map((file) => ({ file, type: selectedType })));
    },
    [mode, selectedType, levelMode, autotuneIntensity, onFilesSelected, onQuickMaster, onAssemblyLine, onAutoLevel, onBeatStation, onAutotune, onVocalFix, onRepair]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []).filter(isAudioFile);
      if (files.length === 0) return;

      if (mode === 'automaster' && onQuickMaster) onQuickMaster(files[0]);
      else if (mode === 'assembly' && onAssemblyLine) onAssemblyLine(files[0]);
      else if (mode === 'autolevel' && onAutoLevel) onAutoLevel(files[0], levelMode);
      else if (mode === 'beat' && onBeatStation) onBeatStation(files[0]);
      else if (mode === 'autotune' && onAutotune) onAutotune(files[0], autotuneIntensity);
      else if (mode === 'vocalfix' && onVocalFix) onVocalFix(files[0]);
      else if (mode === 'repair' && onRepair) onRepair(files[0]);
      else if (mode === 'delivery') return;
      else onFilesSelected(files.map((file) => ({ file, type: selectedType })));
      e.target.value = '';
    },
    [mode, selectedType, levelMode, autotuneIntensity, onFilesSelected, onQuickMaster, onAssemblyLine, onAutoLevel, onBeatStation, onAutotune, onVocalFix, onRepair]
  );

  const manualBusy =
    (mode === 'automaster' && isQuickMastering) ||
    (mode === 'automix' && isAutoMixing) ||
    (mode === 'autolevel' && isAutoLeveling) ||
    (mode === 'beat' && isBeatStation) ||
    (mode === 'autotune' && isAutotuning) ||
    (mode === 'vocalfix' && isVocalFixing) ||
    (mode === 'repair' && isRepairing);

  return (
    <div className="space-y-3">
      {/* ── HERO: Full auto assembly line (always visible) ───────── */}
      <div
        className="station-bay"
        style={
          {
            '--station-color': assemblyTheme.color,
            '--station-glow': assemblyTheme.glow,
          } as React.CSSProperties
        }
      >
        <div className="station-bay-header">
          <span
            className="studio-led studio-led-on"
            style={{ background: assemblyTheme.color, color: assemblyTheme.color }}
          />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[11px] tracking-[0.14em]" style={{ color: assemblyTheme.color }}>
              FULL AUTO ASSEMBLY LINE
            </p>
            <p className="text-[9px] text-studio-muted font-mono truncate">
              1. Drop MP3 · 2. Studio Tune + Enhance · 3. Press Start
            </p>
          </div>
          <span
            className="text-[8px] font-mono px-1.5 py-0.5 rounded border shrink-0"
            style={{
              color: assemblyTheme.color,
              borderColor: `${assemblyTheme.color}55`,
              background: `${assemblyTheme.color}18`,
            }}
          >
            DROP + START
          </span>
        </div>

        <div className="p-3 space-y-3">
          {isAssemblyLine ? (
            <>
              <ProgressBlock
                color={assemblyTheme.color}
                icon={<Factory size={14} />}
                label={assemblyStage || 'Assembly Line'}
                progress={assemblyProgress}
                message={assemblyMessage}
              />
              {onCancelAssemblyLine && (
                <button
                  type="button"
                  onClick={onCancelAssemblyLine}
                  className="w-full py-2 rounded-md text-[10px] font-mono border border-red-500/30 text-red-300 hover:bg-red-500/10"
                >
                  CANCEL PIPELINE
                </button>
              )}
            </>
          ) : (
            <>
              <DropZone
                dragOver={assemblyDragOver}
                setDragOver={setAssemblyDragOver}
                onDrop={handleAssemblyDrop}
                onFileInput={handleAssemblyFileInput}
                color={assemblyTheme.color}
                icon={<Upload size={20} />}
                title={assemblyFile ? 'Replace audio file' : 'Drop MP3 / WAV here'}
                subtitle={assemblyFile ? 'Click or drop to choose a different file' : 'MP3 · WAV · FLAC · M4A'}
              />

              {assemblyFile ? (
                <div
                  className="flex items-center gap-2 px-2.5 py-2 rounded-md border"
                  style={{
                    borderColor: `${assemblyTheme.color}44`,
                    background: assemblyTheme.glow,
                  }}
                >
                  <Music size={14} style={{ color: assemblyTheme.color }} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-mono text-studio-text truncate">{assemblyFile.name}</p>
                    <p className="text-[8px] font-mono text-studio-muted">
                      {(assemblyFile.size / (1024 * 1024)).toFixed(1)} MB · ready
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearAssemblyFile}
                    className="text-[8px] font-mono px-1.5 py-1 rounded border border-white/10 text-studio-muted hover:text-studio-text hover:bg-white/5 shrink-0"
                  >
                    CLEAR
                  </button>
                </div>
              ) : (
                <p className="text-[9px] font-mono text-studio-muted text-center">
                  No file selected yet
                </p>
              )}

              <button
                type="button"
                onClick={() => setStudioTuneEnabled((v) => !v)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md border transition-all text-left"
                style={
                  studioTuneEnabled
                    ? {
                        borderColor: '#a78bfa66',
                        background: 'rgba(167, 139, 250, 0.12)',
                      }
                    : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.25)' }
                }
              >
                <Mic
                  size={14}
                  className="shrink-0"
                  style={{ color: studioTuneEnabled ? '#a78bfa' : '#6b7280' }}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[10px] font-display tracking-wider"
                    style={{ color: studioTuneEnabled ? '#c4b5fd' : '#9ca3af' }}
                  >
                    STUDIO TUNE {studioTuneEnabled ? 'ON' : 'OFF'}
                  </p>
                  <p className="text-[8px] font-mono text-studio-muted leading-snug">
                    Natural pitch polish — keeps vibrato, not T-Pain
                  </p>
                </div>
                <span
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded border shrink-0"
                  style={{
                    color: studioTuneEnabled ? '#c4b5fd' : '#6b7280',
                    borderColor: studioTuneEnabled ? '#a78bfa55' : 'rgba(255,255,255,0.1)',
                  }}
                >
                  {studioTuneEnabled ? 'NATURAL' : 'OFF'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setHitMakerEnabled((v) => !v)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md border transition-all text-left"
                style={
                  hitMakerEnabled
                    ? {
                        borderColor: '#38bdf866',
                        background: 'rgba(56, 189, 248, 0.12)',
                      }
                    : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.25)' }
                }
              >
                <Sparkles
                  size={14}
                  className="shrink-0"
                  style={{ color: hitMakerEnabled ? '#38bdf8' : '#6b7280' }}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[10px] font-display tracking-wider"
                    style={{ color: hitMakerEnabled ? '#7dd3fc' : '#9ca3af' }}
                  >
                    SMART ENHANCE {hitMakerEnabled ? 'ON' : 'OFF'}
                  </p>
                  <p className="text-[8px] font-mono text-studio-muted leading-snug">
                    Analyzes vibe · adapts polish (gentle ballad → punchy hit)
                  </p>
                </div>
                <span
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded border shrink-0"
                  style={{
                    color: hitMakerEnabled ? '#7dd3fc' : '#6b7280',
                    borderColor: hitMakerEnabled ? '#38bdf855' : 'rgba(255,255,255,0.1)',
                  }}
                >
                  {hitMakerEnabled ? 'AUTO' : 'OFF'}
                </span>
              </button>

              <button
                type="button"
                onClick={startAssemblyLine}
                disabled={!assemblyFile || !onAssemblyLine}
                className="w-full py-3 rounded-md text-[12px] font-display tracking-[0.16em] disabled:opacity-35 disabled:cursor-not-allowed transition-all"
                style={{
                  background: assemblyFile
                    ? `linear-gradient(180deg, ${assemblyTheme.color}, color-mix(in srgb, ${assemblyTheme.color} 65%, #000))`
                    : '#1a1a22',
                  color: assemblyFile ? '#0a0a0c' : '#6b7280',
                  boxShadow: assemblyFile ? `0 0 18px ${assemblyTheme.glow}` : undefined,
                }}
              >
                START FULL PIPELINE
              </button>
            </>
          )}
        </div>
      </div>

      {/* Manual / individual stations (optional) */}
      <button
        type="button"
        onClick={() => setShowManualStations((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-studio-border/80 bg-black/20 hover:bg-white/[0.03] transition-colors"
      >
        <span className="text-[9px] font-mono tracking-wider text-studio-muted">
          MANUAL STATIONS (OPTIONAL)
        </span>
        <span className="text-[9px] font-mono text-studio-muted">
          {showManualStations ? 'HIDE' : 'SHOW'}
        </span>
      </button>

      {showManualStations && (
        <>
          <div className="studio-rack px-3 py-2.5">
            <span className="studio-screw top-1.5 left-1.5" />
            <span className="studio-screw top-1.5 right-1.5" />
            <span className="studio-screw bottom-1.5 left-1.5" />
            <span className="studio-screw bottom-1.5 right-1.5" />
            <div className="flex items-center justify-between px-1">
              <div>
                <p className="font-display text-[10px] tracking-[0.2em] text-studio-accent">SIGNAL PATH</p>
                <p className="text-[9px] text-studio-muted font-mono mt-0.5">Run one bay at a time</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {STATION_ORDER.filter((id) => id !== 'assembly').map((id) => {
              const s = STATION_THEMES[id];
              const active = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectStation(id)}
                  className={cn('station-module px-2.5 py-2.5', active && 'station-module-active')}
                  style={
                    {
                      '--station-color': s.color,
                      '--station-glow': s.glow,
                      borderColor: active ? s.color : 'rgba(44,44,54,0.9)',
                      background: active
                        ? `linear-gradient(135deg, ${s.glow}, #121218 55%)`
                        : undefined,
                    } as React.CSSProperties
                  }
                >
                  <span className="station-stripe" />
                  <div className="pl-2 flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: s.color }}>{STATION_ICONS[id]}</span>
                      <span
                        className="font-display text-[9px] tracking-[0.12em] truncate"
                        style={{ color: active ? s.color : '#9ca3af' }}
                      >
                        {s.short}
                      </span>
                      {active && (
                        <span
                          className="ml-auto studio-led studio-led-on shrink-0"
                          style={{ background: s.color, color: s.color }}
                        />
                      )}
                    </div>
                    <p className="text-[8px] text-studio-muted leading-tight truncate text-left pl-0.5">
                      {s.title}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <div
            className="station-bay"
            style={
              {
                '--station-color': theme.color,
                '--station-glow': theme.glow,
              } as React.CSSProperties
            }
          >
            <div className="station-bay-header">
              <span className="studio-led" style={{ background: theme.color, color: theme.color }} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-[11px] tracking-[0.14em]" style={{ color: theme.color }}>
                  {theme.title.toUpperCase()}
                </p>
                <p className="text-[9px] text-studio-muted font-mono truncate">{theme.subtitle}</p>
              </div>
              <span
                className="text-[8px] font-mono px-1.5 py-0.5 rounded border shrink-0"
                style={{
                  color: theme.color,
                  borderColor: `${theme.color}55`,
                  background: `${theme.color}18`,
                }}
              >
                MANUAL
              </span>
            </div>

            <div className="p-3 space-y-3">
              {manualBusy ? (
                <ProgressBlock
                  color={theme.color}
                  icon={STATION_ICONS[mode]}
                  label={
                    mode === 'automaster'
                      ? 'Mastering'
                      : mode === 'automix'
                      ? 'Mixing'
                      : mode === 'autolevel'
                      ? 'Levelling'
                      : mode === 'beat'
                      ? 'Beat Lab'
                      : mode === 'autotune'
                      ? 'Auto-Tune'
                      : mode === 'repair'
                      ? 'Repair'
                      : 'Vocal Fix'
                  }
                  progress={
                    mode === 'automaster'
                      ? quickMasterProgress
                      : mode === 'automix'
                      ? autoMixProgress
                      : mode === 'autolevel'
                      ? autoLevelProgress
                      : mode === 'beat'
                      ? beatStationProgress
                      : mode === 'autotune'
                      ? autotuneProgress
                      : mode === 'repair'
                      ? repairProgress
                      : vocalFixProgress
                  }
                  message={
                    mode === 'automaster'
                      ? quickMasterMessage
                      : mode === 'automix'
                      ? autoMixMessage
                      : mode === 'autolevel'
                      ? autoLevelMessage
                      : mode === 'beat'
                      ? beatStationMessage
                      : mode === 'autotune'
                      ? autotuneMessage
                      : mode === 'repair'
                      ? repairMessage
                      : vocalFixMessage
                  }
                />
              ) : (
                <>
                  {mode === 'assembly' && (
                    <p className="text-[10px] text-studio-muted font-mono text-center py-2">
                      Use the Full Auto drop zone above — no station switching needed.
                    </p>
                  )}

                  {mode === 'automix' && (
                    <>
                      <div className="flex gap-1 flex-wrap">
                        {stemConfig.map((stem) => (
                          <button
                            key={stem.type}
                            onClick={() => setSelectedType(stem.type)}
                            className={cn(
                              'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-all',
                              selectedType === stem.type
                                ? 'text-black border-transparent'
                                : 'text-studio-muted border-studio-border'
                            )}
                            style={
                              selectedType === stem.type
                                ? { backgroundColor: stem.color }
                                : undefined
                            }
                          >
                            {STEM_ICONS[stem.type]}
                            {stem.label}
                          </button>
                        ))}
                      </div>
                      <DropZone
                        dragOver={dragOver}
                        setDragOver={setDragOver}
                        onDrop={handleDrop}
                        onFileInput={handleFileInput}
                        color={theme.color}
                        icon={<Upload size={20} />}
                        title="Load stems into the mix console"
                        subtitle="Multi-file · then run Auto Mix"
                        multiple
                      />
                      {onAutoMix && (
                        <button
                          onClick={onAutoMix}
                          disabled={existingStems.length < 2}
                          className="w-full py-2.5 rounded-md text-[11px] font-display tracking-wider disabled:opacity-30 transition-all"
                          style={{
                            background: `linear-gradient(180deg, ${theme.color}, color-mix(in srgb, ${theme.color} 70%, #000))`,
                            color: '#0a0a0c',
                            boxShadow: `0 0 16px ${theme.glow}`,
                          }}
                        >
                          RUN AUTO MIX
                        </button>
                      )}
                    </>
                  )}

                  {mode === 'automaster' && (
                    <DropZone
                      dragOver={dragOver}
                      setDragOver={setDragOver}
                      onDrop={handleDrop}
                      onFileInput={handleFileInput}
                      color={theme.color}
                      icon={<Wand2 size={20} />}
                      title="Drop finished mix"
                      subtitle="Stereo master · EQ → limit → LUFS"
                    />
                  )}

                  {mode === 'autolevel' && (
                    <>
                      <div className="flex gap-1">
                        {(
                          [
                            { id: 'mix' as LevelingMode, label: 'MIX −18' },
                            { id: 'loudness' as LevelingMode, label: 'LOUD' },
                            { id: 'peak' as LevelingMode, label: 'PEAK' },
                          ] as const
                        ).map((m) => (
                          <button
                            key={m.id}
                            onClick={() => setLevelMode(m.id)}
                            className="flex-1 py-1.5 rounded text-[8px] font-mono border transition-all"
                            style={
                              levelMode === m.id
                                ? {
                                    color: theme.color,
                                    borderColor: `${theme.color}66`,
                                    background: theme.glow,
                                  }
                                : { color: '#6b7280', borderColor: '#2c2c36' }
                            }
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <DropZone
                        dragOver={dragOver}
                        setDragOver={setDragOver}
                        onDrop={handleDrop}
                        onFileInput={handleFileInput}
                        color={theme.color}
                        icon={<Volume2 size={20} />}
                        title="Drop audio to gain-stage"
                        subtitle="Healthy volume · not mastering"
                      />
                    </>
                  )}

                  {mode === 'beat' && (
                    <DropZone
                      dragOver={dragOver}
                      setDragOver={setDragOver}
                      onDrop={handleDrop}
                      onFileInput={handleFileInput}
                      color={theme.color}
                      icon={<Drum size={20} />}
                      title="Drop beat / instrumental"
                      subtitle="Punch · sub · vocal pocket"
                    />
                  )}

                  {mode === 'autotune' && (
                    <>
                      <div className="space-y-2 rounded-md border border-white/5 bg-black/30 p-2.5">
                        <div className="flex items-center justify-between text-[9px] font-mono">
                          <span className="text-studio-muted">NATURAL</span>
                          <span style={{ color: theme.color }}>
                            {autotuneIntensity} · {intensityToLabel(autotuneIntensity).toUpperCase()}
                          </span>
                          <span className="text-studio-muted">T-PAIN</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={autotuneIntensity}
                          onChange={(e) => setAutotuneIntensity(Number(e.target.value))}
                          className="w-full h-1.5"
                          style={{ accentColor: theme.color }}
                        />
                        <div className="flex flex-wrap gap-1">
                          {AUTOTUNE_PRESETS.map((p) => (
                            <button
                              key={p.label}
                              title={p.description}
                              onClick={() => setAutotuneIntensity(p.intensity)}
                              className="px-1.5 py-0.5 rounded text-[8px] font-mono border"
                              style={
                                intensityToLabel(autotuneIntensity) === p.label
                                  ? {
                                      color: theme.color,
                                      borderColor: `${theme.color}66`,
                                      background: theme.glow,
                                    }
                                  : { color: '#6b7280', borderColor: '#2c2c36' }
                              }
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <DropZone
                        dragOver={dragOver}
                        setDragOver={setDragOver}
                        onDrop={handleDrop}
                        onFileInput={handleFileInput}
                        color={theme.color}
                        icon={<AudioLines size={20} />}
                        title="Drop dry vocal"
                        subtitle={`${intensityToLabel(autotuneIntensity)} @ ${autotuneIntensity}`}
                      />
                    </>
                  )}

                  {mode === 'vocalfix' && (
                    <DropZone
                      dragOver={dragOver}
                      setDragOver={setDragOver}
                      onDrop={handleDrop}
                      onFileInput={handleFileInput}
                      color={theme.color}
                      icon={<Mic2 size={20} />}
                      title="Drop vocal take"
                      subtitle="Cleanup → pitch → EQ → chain"
                    />
                  )}

                  {mode === 'repair' && (
                    <DropZone
                      dragOver={dragOver}
                      setDragOver={setDragOver}
                      onDrop={handleDrop}
                      onFileInput={handleFileInput}
                      color={theme.color}
                      icon={<Wrench size={20} />}
                      title="Drop noisy / damaged audio"
                      subtitle="Denoise · declick · de-hum"
                    />
                  )}

                  {mode === 'delivery' && (
                    <p className="text-[10px] text-studio-muted font-mono text-center leading-relaxed py-3">
                      Use Delivery Bay below for bounce options. Full Auto already downloads the mastered MP3 when the pipeline finishes.
                    </p>
                  )}
                </>
              )}

              {existingStems.length > 0 && (
                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                  <span className="text-[9px] font-mono text-studio-muted">CHANNELS LOADED</span>
                  <span className="text-[10px] font-mono font-semibold tabular-nums" style={{ color: theme.color }}>
                    {existingStems.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
