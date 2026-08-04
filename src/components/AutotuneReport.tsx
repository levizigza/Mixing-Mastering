'use client';

import React, { useState } from 'react';
import { AudioLines, ChevronDown, ChevronUp, X } from 'lucide-react';
import { AutotuneStationResult } from '@/lib/autotune-station';

interface AutotuneReportProps {
  result: AutotuneStationResult;
  trackName: string;
  onDismiss?: () => void;
  onSwapAB?: () => void;
}

export default function AutotuneReport({ result, trackName, onDismiss, onSwapAB }: AutotuneReportProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="studio-panel overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2">
          <AudioLines size={14} className="text-fuchsia-400" />
          <span className="text-xs font-semibold">Auto-Tune Report</span>
          <span className="text-[9px] text-fuchsia-300/80 bg-fuchsia-500/10 px-1.5 py-0.5 rounded font-mono truncate max-w-[80px]">
            {trackName}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onDismiss && (
            <span role="button" onClick={(e) => { e.stopPropagation(); onDismiss(); }} className="p-0.5 rounded hover:bg-white/10 text-studio-muted">
              <X size={12} />
            </span>
          )}
          {expanded ? <ChevronUp size={13} className="text-studio-muted" /> : <ChevronDown size={13} className="text-studio-muted" />}
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-studio-border/60 pt-2.5">
          <div className="text-[10px] text-fuchsia-200/90">
            {result.label} · {result.intensity}/100 · Key {result.key} {result.scale}
          </div>
          <ul className="space-y-1">
            {result.notes.map((n, i) => (
              <li key={i} className="text-[10px] text-studio-muted leading-relaxed">· {n}</li>
            ))}
          </ul>
          {onSwapAB && (
            <button
              type="button"
              onClick={onSwapAB}
              className="text-[9px] font-mono px-2 py-1 rounded border border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/10"
            >
              SWAP A/B
            </button>
          )}
        </div>
      )}
    </div>
  );
}
