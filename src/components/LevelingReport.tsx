'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Gauge, X, Volume2 } from 'lucide-react';
import { LevelingResult } from '@/lib/audio-leveler';
import { formatDb } from '@/lib/utils';

interface LevelingReportProps {
  result: LevelingResult;
  trackName: string;
  onDismiss?: () => void;
}

export default function LevelingReport({ result, trackName, onDismiss }: LevelingReportProps) {
  const [expanded, setExpanded] = useState(true);
  const { analysisBefore: before, analysisAfter: after, gainAppliedDb, mode, recommendations } = result;

  return (
    <div className="studio-panel overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Gauge size={14} className="text-sky-400" />
          <span className="text-xs font-semibold text-studio-text">Auto Level Report</span>
          <span className="text-[9px] text-sky-300/80 bg-sky-500/10 px-1.5 py-0.5 rounded font-mono truncate max-w-[90px]">
            {trackName}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onDismiss && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              className="p-0.5 rounded hover:bg-white/10 text-studio-muted hover:text-studio-text"
            >
              <X size={12} />
            </span>
          )}
          {expanded ? <ChevronUp size={13} className="text-studio-muted" /> : <ChevronDown size={13} className="text-studio-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2.5 border-t border-studio-border/60 pt-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-sky-200/90">
            <Volume2 size={11} />
            Mode: <span className="font-mono uppercase">{mode}</span>
            <span className="text-studio-muted">·</span>
            Gain: <span className="font-mono">{gainAppliedDb >= 0 ? '+' : ''}{gainAppliedDb.toFixed(1)} dB</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded bg-studio-bg/60 p-2 space-y-1">
              <div className="text-studio-muted uppercase tracking-wide text-[9px]">Before</div>
              <div>Peak {formatDb(before.peakDb)}</div>
              <div>RMS {formatDb(before.rmsDb)}</div>
              <div>~LUFS {before.estimatedLUFS.toFixed(1)}</div>
            </div>
            <div className="rounded bg-sky-500/10 p-2 space-y-1 border border-sky-500/20">
              <div className="text-sky-300/80 uppercase tracking-wide text-[9px]">After</div>
              <div>Peak {formatDb(after.peakDb)}</div>
              <div>RMS {formatDb(after.rmsDb)}</div>
              <div>~LUFS {after.estimatedLUFS.toFixed(1)}</div>
            </div>
          </div>

          <ul className="space-y-1">
            {recommendations.map((r, i) => (
              <li key={i} className="text-[10px] text-studio-muted leading-relaxed">
                · {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
