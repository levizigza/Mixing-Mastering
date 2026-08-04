'use client';

import React from 'react';
import { BusState, BusId, SendFxId } from '@/types/audio';
import { cn } from '@/lib/utils';

interface BusPanelProps {
  buses: BusState[];
  selectedStemId: string | null;
  stemSends: Partial<Record<SendFxId, number>>;
  onBusChange: (id: BusId, patch: Partial<BusState>) => void;
  onStemSendChange: (fx: SendFxId, level: number) => void;
}

export default function BusPanel({
  buses,
  selectedStemId,
  stemSends,
  onBusChange,
  onStemSendChange,
}: BusPanelProps) {
  return (
    <div className="studio-panel p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-display text-[9px] tracking-[0.18em] text-studio-accent">GROUP BUSES</p>
        <span className="text-[8px] font-mono text-studio-muted">POST ROUTING</span>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {buses.map((b) => (
          <div
            key={b.id}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded border border-studio-border bg-black/20',
              b.solo && 'border-amber-500/40',
              b.mute && 'opacity-50'
            )}
          >
            <span className="w-14 text-[9px] font-mono text-studio-text truncate">{b.label}</span>
            <input
              type="range"
              min={-24}
              max={12}
              step={0.5}
              value={b.gain}
              onChange={(e) => onBusChange(b.id, { gain: Number(e.target.value) })}
              className="flex-1 h-1 accent-amber-400"
            />
            <span className="w-8 text-[8px] font-mono text-studio-muted tabular-nums text-right">
              {b.gain > 0 ? '+' : ''}
              {b.gain.toFixed(0)}
            </span>
            <button
              type="button"
              onClick={() => onBusChange(b.id, { mute: !b.mute })}
              className={cn(
                'text-[8px] font-mono px-1 rounded border',
                b.mute ? 'border-red-500/50 text-red-400' : 'border-studio-border text-studio-muted'
              )}
            >
              M
            </button>
            <button
              type="button"
              onClick={() => onBusChange(b.id, { solo: !b.solo })}
              className={cn(
                'text-[8px] font-mono px-1 rounded border',
                b.solo ? 'border-amber-500/50 text-amber-400' : 'border-studio-border text-studio-muted'
              )}
            >
              S
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-studio-border pt-2 space-y-2">
        <p className="text-[8px] font-mono text-studio-muted tracking-wider">
          STEM SENDS {selectedStemId ? '' : '(select a channel)'}
        </p>
        {(['reverb', 'delay'] as SendFxId[]).map((fx) => (
          <div key={fx} className="flex items-center gap-2">
            <span className="w-12 text-[9px] font-mono uppercase text-studio-text-dim">{fx}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((stemSends[fx] ?? 0) * 100)}
              disabled={!selectedStemId}
              onChange={(e) => onStemSendChange(fx, Number(e.target.value) / 100)}
              className="flex-1 h-1 accent-cyan-400 disabled:opacity-30"
            />
            <span className="w-7 text-[8px] font-mono text-studio-muted text-right">
              {Math.round((stemSends[fx] ?? 0) * 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
