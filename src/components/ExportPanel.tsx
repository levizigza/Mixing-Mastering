'use client';

import React, { useRef, useState } from 'react';
import { Download, Save, Upload, FileAudio, Layers, Zap } from 'lucide-react';
import { ExportBitDepth, DitherType, ExportFormat } from '@/lib/pro-engine';
import { cn } from '@/lib/utils';

interface ExportPreset {
  id: string;
  name: string;
  format: ExportFormat;
  bitDepth: ExportBitDepth;
  dither: DitherType;
  description: string;
}

const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'streaming', name: 'Streaming', format: 'mp3', bitDepth: 16, dither: 'none', description: 'MP3 320kbps for Spotify/Apple/YouTube' },
  { id: 'cd', name: 'CD Master', format: 'wav', bitDepth: 16, dither: 'noise-shaped', description: 'WAV 16-bit/44.1kHz with noise-shaped dither' },
  { id: 'broadcast', name: 'Broadcast', format: 'wav', bitDepth: 24, dither: 'tpdf', description: 'WAV 24-bit for broadcast (EBU R128)' },
  { id: 'hires', name: 'Hi-Res', format: 'wav', bitDepth: 32, dither: 'none', description: 'WAV 32-float for further processing' },
  { id: 'flac-lossless', name: 'FLAC', format: 'flac', bitDepth: 24, dither: 'noise-shaped', description: 'Lossless 24-bit FLAC archive' },
];

interface ExportPanelProps {
  bitDepth: ExportBitDepth;
  dither: DitherType;
  format: ExportFormat;
  isExporting: boolean;
  exportProgress: number;
  stemCount: number;
  onBitDepthChange: (bd: ExportBitDepth) => void;
  onDitherChange: (d: DitherType) => void;
  onFormatChange: (f: ExportFormat) => void;
  onExport: () => void;
  onExportAllStems: () => void;
  onSaveSession: () => void;
  onLoadSession: (json: string) => void;
}

export default function ExportPanel({
  bitDepth,
  dither,
  format,
  isExporting,
  exportProgress,
  stemCount,
  onBitDepthChange,
  onDitherChange,
  onFormatChange,
  onExport,
  onExportAllStems,
  onSaveSession,
  onLoadSession,
}: ExportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPresets, setShowPresets] = useState(false);

  const handleLoadSession = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    onLoadSession(text);
    e.target.value = '';
  };

  const applyExportPreset = (preset: ExportPreset) => {
    onFormatChange(preset.format);
    onBitDepthChange(preset.bitDepth);
    onDitherChange(preset.dither);
    setShowPresets(false);
  };

  const getExportLabel = () => {
    if (format === 'mp3') return 'MP3 (320kbps)';
    if (format === 'flac') return `FLAC (${bitDepth}-bit)`;
    return `WAV (${bitDepth === 32 ? '32-float' : `${bitDepth}-bit`})`;
  };

  return (
    <div className="studio-panel p-3 space-y-3">
      <h3 className="text-[10px] font-bold text-studio-text uppercase tracking-wider">
        Export & Session
      </h3>

      {/* Export Presets */}
      <div className="space-y-1">
        <button
          onClick={() => setShowPresets(!showPresets)}
          className="w-full flex items-center justify-between px-2 py-1 rounded text-[9px] font-mono text-studio-muted hover:text-studio-text border border-studio-border hover:border-studio-muted transition-all"
        >
          <span className="flex items-center gap-1"><Zap size={10} /> Quick Presets</span>
          <span className="text-[8px]">{showPresets ? '▲' : '▼'}</span>
        </button>
        {showPresets && (
          <div className="space-y-0.5 animate-fade-in">
            {EXPORT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyExportPreset(preset)}
                className="w-full text-left px-2 py-1.5 rounded text-[9px] font-mono hover:bg-white/5 transition-colors group"
              >
                <div className="flex justify-between items-center">
                  <span className="text-studio-text group-hover:text-studio-accent">{preset.name}</span>
                  <span className="text-[8px] text-studio-muted">{preset.format.toUpperCase()}</span>
                </div>
                <span className="text-[8px] text-studio-muted">{preset.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Format */}
      <div className="space-y-1">
        <span className="studio-label">Format</span>
        <div className="flex gap-1">
          {(['wav', 'mp3', 'flac'] as ExportFormat[]).map((f) => (
            <button
              key={f}
              onClick={() => onFormatChange(f)}
              className={cn(
                'flex-1 px-2 py-1 rounded text-[10px] font-mono font-medium transition-all border',
                format === f
                  ? 'bg-studio-accent text-white border-studio-accent'
                  : 'text-studio-muted border-studio-border hover:text-studio-text'
              )}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Bit Depth (WAV/FLAC) */}
      {(format === 'wav' || format === 'flac') && <div className="space-y-1">
        <span className="studio-label">Bit Depth</span>
        <div className="flex gap-1">
          {([16, 24, 32] as ExportBitDepth[]).map((bd) => (
            <button
              key={bd}
              onClick={() => onBitDepthChange(bd)}
              className={cn(
                'flex-1 px-2 py-1 rounded text-[10px] font-mono font-medium transition-all border',
                bitDepth === bd
                  ? 'bg-studio-accent text-white border-studio-accent'
                  : 'text-studio-muted border-studio-border hover:text-studio-text'
              )}
            >
              {bd === 32 ? '32f' : bd}-bit
            </button>
          ))}
        </div>
      </div>}

      {/* Dithering (WAV/FLAC) */}
      {(format === 'wav' || format === 'flac') && <div className="space-y-1">
        <span className="studio-label">Dithering</span>
        <div className="flex gap-1">
          {(['none', 'tpdf', 'noise-shaped'] as DitherType[]).map((dt) => (
            <button
              key={dt}
              onClick={() => onDitherChange(dt)}
              className={cn(
                'flex-1 px-1 py-1 rounded text-[9px] font-mono font-medium transition-all border',
                dither === dt
                  ? 'bg-studio-accent text-white border-studio-accent'
                  : 'text-studio-muted border-studio-border hover:text-studio-text'
              )}
            >
              {dt === 'noise-shaped' ? 'NS' : dt === 'tpdf' ? 'TPDF' : 'Off'}
            </button>
          ))}
        </div>
        <span className="text-[8px] text-studio-muted">
          {dither === 'noise-shaped' ? 'Noise-shaped (pushes noise above 14kHz)' : dither === 'tpdf' ? 'Triangular PDF dithering' : 'No dithering (truncation)'}
        </span>
      </div>}

      {/* MP3 info */}
      {format === 'mp3' && (
        <div className="text-[9px] text-studio-muted bg-white/5 rounded p-2">
          320 kbps CBR • Lossy compression • Best for streaming/preview
        </div>
      )}

      {/* FLAC info */}
      {format === 'flac' && (
        <div className="text-[9px] text-studio-muted bg-white/5 rounded p-2">
          Exports lossless WAV (FLAC encoder not bundled) • Use WAV for archival
        </div>
      )}

      {/* Export Button */}
      <button
        onClick={onExport}
        disabled={isExporting}
        className={cn(
          'w-full studio-button-accent flex items-center justify-center gap-2 py-2',
          isExporting && 'opacity-60 cursor-not-allowed'
        )}
      >
        {isExporting ? (
          <>
            <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
            <span>Rendering {Math.round(exportProgress)}%</span>
          </>
        ) : (
          <>
            <FileAudio size={14} />
            <span>Export {getExportLabel()}</span>
          </>
        )}
      </button>

      {/* Stem Export */}
      {stemCount > 0 && (
        <button
          onClick={onExportAllStems}
          disabled={isExporting}
          className={cn(
            'w-full studio-button flex items-center justify-center gap-2 py-1.5 text-[10px]',
            isExporting && 'opacity-40 cursor-not-allowed'
          )}
        >
          <Layers size={12} />
          <span>Export All Stems ({stemCount})</span>
        </button>
      )}

      {/* Progress bar */}
      {isExporting && (
        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-studio-accent rounded-full transition-all duration-200"
            style={{ width: `${exportProgress}%` }}
          />
        </div>
      )}

      {/* Session Controls */}
      <div className="border-t border-studio-border pt-2 space-y-1.5">
        <span className="studio-label">Session</span>
        <div className="flex gap-1.5">
          <button onClick={onSaveSession} className="studio-button flex-1 flex items-center justify-center gap-1 py-1.5">
            <Save size={12} />
            <span className="text-[10px]">Save</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="studio-button flex-1 flex items-center justify-center gap-1 py-1.5"
          >
            <Upload size={12} />
            <span className="text-[10px]">Load</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleLoadSession}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
}
