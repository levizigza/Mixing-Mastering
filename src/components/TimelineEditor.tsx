'use client';

import React, { useRef, useCallback, useState } from 'react';
import { AudioClip, SongSection, Stem } from '@/types/audio';
import { cn, clamp, generateId } from '@/lib/utils';
import { SECTION_COLORS } from '@/lib/defaults';
import { Scissors, Trash2 } from 'lucide-react';

interface TimelineEditorProps {
  stems: Stem[];
  clips: AudioClip[];
  sections: SongSection[];
  duration: number;
  currentTime: number;
  bpm?: number;
  snapEnabled: boolean;
  onSeek: (t: number) => void;
  onUpdateClip: (id: string, patch: Partial<AudioClip>) => void;
  onRemoveClip: (id: string) => void;
  onSplitClip: (id: string, atTime: number) => void;
  onAddSection: (section: SongSection) => void;
  onRemoveSection: (id: string) => void;
  onToggleSnap: () => void;
}

export default function TimelineEditor({
  stems,
  clips,
  sections,
  duration,
  currentTime,
  bpm = 120,
  snapEnabled,
  onSeek,
  onUpdateClip,
  onRemoveClip,
  onSplitClip,
  onAddSection,
  onRemoveSection,
  onToggleSnap,
}: TimelineEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const snap = useCallback(
    (t: number) => {
      if (!snapEnabled || bpm <= 0) return t;
      const beat = 60 / bpm;
      return Math.round(t / beat) * beat;
    },
    [snapEnabled, bpm]
  );

  const timeFromX = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
    },
    [duration]
  );

  const handleLaneClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-clip]')) return;
    onSeek(snap(timeFromX(e.clientX)));
  };

  if (stems.length === 0 || duration <= 0) {
    return (
      <div className="studio-panel px-3 py-2 text-[10px] text-studio-muted font-mono">
        TIMELINE — load stems to edit clips & sections
      </div>
    );
  }

  return (
    <div className="studio-panel overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-studio-border bg-black/20">
        <p className="font-display text-[9px] tracking-[0.16em] text-studio-accent">TIMELINE</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleSnap}
            className={cn(
              'text-[8px] font-mono px-1.5 py-0.5 rounded border',
              snapEnabled ? 'border-amber-500/40 text-amber-300' : 'border-studio-border text-studio-muted'
            )}
          >
            SNAP {bpm.toFixed(0)}BPM
          </button>
          <button
            type="button"
            onClick={() => {
              const start = currentTime;
              const end = Math.min(duration, start + 8);
              onAddSection({
                id: generateId(),
                kind: 'verse',
                name: 'Verse',
                start,
                end,
                color: SECTION_COLORS.verse,
              });
            }}
            className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-studio-border text-studio-muted hover:text-studio-text"
          >
            + SECTION
          </button>
        </div>
      </div>

      {/* Sections lane */}
      <div className="relative h-5 border-b border-studio-border/60 bg-black/30 mx-0" ref={ref} onClick={handleLaneClick}>
        {sections.map((s) => (
          <div
            key={s.id}
            className="absolute top-0.5 bottom-0.5 rounded-sm border border-white/10 flex items-center px-1 group"
            style={{
              left: `${(s.start / duration) * 100}%`,
              width: `${((s.end - s.start) / duration) * 100}%`,
              background: s.color + '55',
            }}
            title={s.name}
          >
            <span className="text-[7px] font-mono truncate text-white/80">{s.name}</span>
            <button
              type="button"
              className="ml-auto opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveSection(s.id);
              }}
            >
              <Trash2 size={8} className="text-white/70" />
            </button>
          </div>
        ))}
        <div
          className="absolute top-0 bottom-0 w-px bg-amber-400 z-10 pointer-events-none"
          style={{ left: `${(currentTime / duration) * 100}%` }}
        />
      </div>

      <div className="max-h-40 overflow-y-auto" onClick={handleLaneClick}>
        {stems.map((stem) => {
          const stemClips = clips.filter((c) => c.stemId === stem.id);
          return (
            <div key={stem.id} className="flex border-b border-studio-border/40 min-h-[28px]">
              <div className="w-20 shrink-0 px-1.5 py-1 text-[8px] font-mono text-studio-muted truncate border-r border-studio-border/40">
                {stem.name}
              </div>
              <div className="flex-1 relative">
                {stemClips.map((clip) => (
                  <div
                    key={clip.id}
                    data-clip
                    className="absolute top-0.5 bottom-0.5 rounded border border-emerald-500/40 bg-emerald-500/25 cursor-grab active:cursor-grabbing flex items-center gap-0.5 px-0.5 group"
                    style={{
                      left: `${(clip.startTime / duration) * 100}%`,
                      width: `${Math.max(0.5, (clip.duration / duration) * 100)}%`,
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDragId(clip.id);
                      const startX = e.clientX;
                      const orig = clip.startTime;
                      const move = (ev: MouseEvent) => {
                        const el = ref.current;
                        if (!el) return;
                        const dx = ((ev.clientX - startX) / el.getBoundingClientRect().width) * duration;
                        onUpdateClip(clip.id, { startTime: snap(clamp(orig + dx, 0, duration - clip.duration)) });
                      };
                      const up = () => {
                        setDragId(null);
                        window.removeEventListener('mousemove', move);
                        window.removeEventListener('mouseup', up);
                      };
                      window.addEventListener('mousemove', move);
                      window.addEventListener('mouseup', up);
                    }}
                  >
                    <span className="text-[7px] font-mono text-emerald-100/80 truncate">
                      {clip.duration.toFixed(1)}s
                    </span>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-0.5"
                      title="Split at playhead"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSplitClip(clip.id, currentTime);
                      }}
                    >
                      <Scissors size={8} />
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveClip(clip.id);
                      }}
                    >
                      <Trash2 size={8} />
                    </button>
                  </div>
                ))}
                {stemClips.length === 0 && stem.audioBuffer && (
                  <div
                    className="absolute top-0.5 bottom-0.5 left-0 right-0 rounded bg-white/5 border border-dashed border-white/10"
                    title="Full-stem clip (implicit)"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {dragId && <span className="sr-only">Dragging {dragId}</span>}
    </div>
  );
}
