'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Factory, X } from 'lucide-react';
import {
  AssemblyLineReportData,
  AssemblyStageId,
  ASSEMBLY_STAGE_LABELS,
} from '@/lib/assembly-line';

interface AssemblyLineReportProps {
  result: AssemblyLineReportData;
  trackName: string;
  onDismiss?: () => void;
  onSwapAB?: () => void;
}

const STAGE_ORDER: AssemblyStageId[] = [
  'analyze',
  'repair',
  'level',
  'split',
  'mix',
  'master',
  'done',
];

export default function AssemblyLineReport({
  result,
  trackName,
  onDismiss,
  onSwapAB,
}: AssemblyLineReportProps) {
  const [expanded, setExpanded] = useState(true);
  const doneStages = new Set(result.stageNotes.map((s) => s.stage));

  return (
    <div className="studio-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2">
          <Factory size={14} className="text-violet-400" />
          <span className="text-xs font-semibold">Assembly Line</span>
          <span className="text-[9px] text-violet-300/80 bg-violet-500/10 px-1.5 py-0.5 rounded font-mono truncate max-w-[80px]">
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
              className="p-0.5 rounded hover:bg-white/10 text-studio-muted"
            >
              <X size={12} />
            </span>
          )}
          {expanded ? (
            <ChevronUp size={13} className="text-studio-muted" />
          ) : (
            <ChevronDown size={13} className="text-studio-muted" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2.5 border-t border-studio-border/60 pt-2.5">
          <div className="flex flex-wrap gap-1">
            {STAGE_ORDER.map((id) => (
              <span
                key={id}
                className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${
                  doneStages.has(id)
                    ? 'border-violet-500/40 text-violet-200 bg-violet-500/10'
                    : 'border-studio-border text-studio-muted'
                }`}
              >
                {ASSEMBLY_STAGE_LABELS[id]}
              </span>
            ))}
          </div>

          <div className="text-[10px] text-violet-200/90 font-mono">
            {result.sectionCount} sections · ~{Math.round(result.bpm)} BPM ·{' '}
            {result.finalLUFS.toFixed(1)} LUFS · TP {result.truePeak.toFixed(1)}
          </div>

          {result.diagnosis.issues.length > 0 && (
            <ul className="space-y-1">
              {result.diagnosis.issues.slice(0, 6).map((issue) => (
                <li key={issue.id} className="text-[10px] text-studio-muted leading-relaxed">
                  · [{issue.severity}] {issue.message}
                </li>
              ))}
            </ul>
          )}

          <ul className="space-y-1 max-h-36 overflow-y-auto">
            {result.stageNotes.flatMap((sn) =>
              sn.notes.slice(0, 3).map((n, i) => (
                <li key={`${sn.stage}-${i}`} className="text-[10px] text-studio-muted leading-relaxed">
                  · <span className="text-violet-300/70">{sn.label}:</span> {n}
                </li>
              ))
            )}
          </ul>

          {onSwapAB && (
            <button
              type="button"
              onClick={onSwapAB}
              className="text-[9px] font-mono px-2 py-1 rounded border border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
            >
              SWAP A/B
            </button>
          )}
        </div>
      )}
    </div>
  );
}
