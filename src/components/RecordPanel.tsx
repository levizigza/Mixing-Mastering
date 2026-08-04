'use client';

import React from 'react';
import { Circle, Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecordPanelProps {
  isArmed: boolean;
  isRecording: boolean;
  inputPeak: number;
  elapsed: number;
  metronome: boolean;
  onArm: () => void;
  onDisarm: () => void;
  onStart: () => void;
  onStop: () => void;
  onToggleMetronome: () => void;
}

export default function RecordPanel({
  isArmed,
  isRecording,
  inputPeak,
  elapsed,
  metronome,
  onArm,
  onDisarm,
  onStart,
  onStop,
  onToggleMetronome,
}: RecordPanelProps) {
  const peakPct = Math.min(100, inputPeak * 140);

  return (
    <div className="studio-panel p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="font-display text-[9px] tracking-[0.18em] text-red-400">RECORD</p>
        <span className="text-[8px] font-mono text-studio-muted">OVERDUB</span>
      </div>

      <div className="h-2 rounded-sm bg-black/50 border border-white/5 overflow-hidden">
        <div
          className="h-full transition-all duration-75"
          style={{
            width: `${peakPct}%`,
            background:
              peakPct > 90
                ? '#ef4444'
                : peakPct > 70
                ? '#eab308'
                : '#22c55e',
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        {!isArmed ? (
          <button
            type="button"
            onClick={onArm}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-red-300 text-[10px] font-mono"
          >
            <Mic size={12} />
            ARM MIC
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={isRecording ? onStop : onStart}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[10px] font-mono font-semibold',
                isRecording
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'border border-red-500/50 bg-red-500/20 text-red-200'
              )}
            >
              {isRecording ? (
                <>
                  <Square size={11} />
                  STOP {elapsed.toFixed(1)}s
                </>
              ) : (
                <>
                  <Circle size={11} fill="currentColor" />
                  REC @ PLAYHEAD
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onDisarm}
              disabled={isRecording}
              className="px-2 py-2 rounded-md border border-studio-border text-[9px] font-mono text-studio-muted disabled:opacity-30"
            >
              SAFE
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onToggleMetronome}
        className={cn(
          'w-full py-1.5 rounded text-[9px] font-mono border',
          metronome
            ? 'border-amber-500/40 text-amber-300 bg-amber-500/10'
            : 'border-studio-border text-studio-muted'
        )}
      >
        METRONOME {metronome ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}
