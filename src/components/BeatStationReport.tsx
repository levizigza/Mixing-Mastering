'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Drum, X } from 'lucide-react';

interface BeatStationReportProps {
  trackName: string;
  presetName: string;
  notes: string[];
  bpm?: number;
  onDismiss?: () => void;
}

export default function BeatStationReport({
  trackName,
  presetName,
  notes,
  bpm,
  onDismiss,
}: BeatStationReportProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="studio-panel overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Drum size={14} className="text-amber-400" />
          <span className="text-xs font-semibold text-studio-text">Beat Station Report</span>
          <span className="text-[9px] text-amber-300/80 bg-amber-500/10 px-1.5 py-0.5 rounded font-mono truncate max-w-[90px]">
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
        <div className="px-4 pb-3 space-y-2 border-t border-studio-border/60 pt-2.5">
          <div className="text-[10px] text-amber-200/90">
            Profile: <span className="font-semibold">{presetName}</span>
            {bpm != null && bpm > 0 && (
              <span className="text-studio-muted"> · ~{Math.round(bpm)} BPM</span>
            )}
          </div>
          <ul className="space-y-1">
            {notes.map((n, i) => (
              <li key={i} className="text-[10px] text-studio-muted leading-relaxed">
                · {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
