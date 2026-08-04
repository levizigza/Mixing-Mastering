'use client';

import React from 'react';
import { BounceMode, DeliveryMetadata } from '@/types/audio';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DeliveryPanelProps {
  metadata: DeliveryMetadata;
  bounceMode: BounceMode;
  onMetadataChange: (patch: Partial<DeliveryMetadata>) => void;
  onBounceModeChange: (mode: BounceMode) => void;
  onBounce: () => void;
  isExporting: boolean;
  exportProgress: number;
}

const MODES: { id: BounceMode; label: string }[] = [
  { id: 'fullmix', label: 'FULL MIX' },
  { id: 'region', label: 'REGION' },
  { id: 'stems', label: 'STEMS' },
  { id: 'instrumental', label: 'INST' },
  { id: 'acapella', label: 'ACAPELLA' },
];

export default function DeliveryPanel({
  metadata,
  bounceMode,
  onMetadataChange,
  onBounceModeChange,
  onBounce,
  isExporting,
  exportProgress,
}: DeliveryPanelProps) {
  return (
    <div className="studio-panel p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="font-display text-[9px] tracking-[0.18em] text-slate-300">DELIVERY</p>
        <Package size={12} className="text-slate-400" />
      </div>

      <div className="flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onBounceModeChange(m.id)}
            className={cn(
              'px-1.5 py-1 rounded text-[8px] font-mono border',
              bounceMode === m.id
                ? 'border-slate-400/50 text-slate-100 bg-slate-500/20'
                : 'border-studio-border text-studio-muted'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {(
          [
            ['title', 'Title'],
            ['artist', 'Artist'],
            ['album', 'Album'],
            ['isrc', 'ISRC'],
            ['year', 'Year'],
            ['genre', 'Genre'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-0.5">
            <span className="text-[7px] font-mono text-studio-muted uppercase">{label}</span>
            <input
              value={metadata[key]}
              onChange={(e) => onMetadataChange({ [key]: e.target.value })}
              className="bg-black/40 border border-studio-border rounded px-1.5 py-1 text-[10px] text-studio-text font-mono"
            />
          </label>
        ))}
      </div>

      <label className="flex items-center gap-2">
        <span className="text-[8px] font-mono text-studio-muted w-16">ALBUM GAP</span>
        <input
          type="number"
          min={0}
          max={10}
          step={0.5}
          value={metadata.albumGapSec}
          onChange={(e) => onMetadataChange({ albumGapSec: Number(e.target.value) })}
          className="flex-1 bg-black/40 border border-studio-border rounded px-1.5 py-1 text-[10px] font-mono"
        />
        <span className="text-[8px] text-studio-muted">sec</span>
      </label>

      {isExporting ? (
        <div className="space-y-1">
          <div className="h-1.5 rounded bg-black/50 overflow-hidden">
            <div className="h-full bg-slate-400 transition-all" style={{ width: `${exportProgress}%` }} />
          </div>
          <p className="text-[9px] font-mono text-center text-studio-muted">Bouncing… {Math.round(exportProgress)}%</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={onBounce}
          className="w-full py-2 rounded-md text-[10px] font-display tracking-wider bg-slate-400 text-black hover:bg-slate-300"
        >
          BOUNCE {bounceMode.toUpperCase()}
        </button>
      )}
    </div>
  );
}
