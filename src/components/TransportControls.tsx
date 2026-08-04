'use client';

import React from 'react';
import { Play, Pause, Square, SkipBack, Repeat, Download, ToggleLeft, ToggleRight } from 'lucide-react';
import { cn, formatTime } from '@/lib/utils';
import { TransportState } from '@/types/audio';

interface TransportControlsProps {
  transport: TransportState;
  abBypass: boolean;
  isExporting: boolean;
  exportProgress: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRewind: () => void;
  onToggleLoop: () => void;
  onToggleABBypass: () => void;
  onExport: () => void;
}

export default function TransportControls({
  transport,
  abBypass,
  isExporting,
  exportProgress,
  onPlay,
  onPause,
  onStop,
  onRewind,
  onToggleLoop,
  onToggleABBypass,
  onExport,
}: TransportControlsProps) {
  return (
    <div className="studio-panel px-4 py-2.5 flex items-center justify-between gap-4">
      {/* Left: Transport buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onRewind}
          className="studio-button p-2"
          title="Rewind"
        >
          <SkipBack size={16} />
        </button>

        {transport.isPlaying ? (
          <button
            onClick={onPause}
            className="studio-button-accent p-2.5 rounded-full"
            title="Pause"
          >
            <Pause size={18} />
          </button>
        ) : (
          <button
            onClick={onPlay}
            className="studio-button-accent p-2.5 rounded-full"
            title="Play"
          >
            <Play size={18} className="ml-0.5" />
          </button>
        )}

        <button
          onClick={onStop}
          className="studio-button p-2"
          title="Stop"
        >
          <Square size={16} />
        </button>

        <button
          onClick={onToggleLoop}
          className={cn(
            'studio-button p-2',
            transport.loop && 'text-studio-accent bg-studio-accent/10 border-studio-accent/30'
          )}
          title="Loop"
        >
          <Repeat size={16} />
        </button>
      </div>

      {/* Center: Time display */}
      <div className="flex items-center gap-3 font-mono">
        <span className="text-lg font-semibold tabular-nums text-studio-text">
          {formatTime(transport.currentTime)}
        </span>
        <span className="text-xs text-studio-muted">/</span>
        <span className="text-sm text-studio-text-dim tabular-nums">
          {formatTime(transport.duration)}
        </span>
      </div>

      {/* Right: A/B bypass + Export */}
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleABBypass}
          className={cn(
            'studio-button flex items-center gap-1.5',
            abBypass && 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
          )}
          title="A/B Bypass - compare with/without processing"
        >
          {abBypass ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          <span className="text-xs font-mono">A/B</span>
        </button>

        <button
          onClick={onExport}
          disabled={isExporting}
          className={cn(
            'studio-button-accent flex items-center gap-1.5',
            isExporting && 'opacity-60 cursor-not-allowed'
          )}
          title="Export to WAV"
        >
          <Download size={16} />
          <span className="text-xs">
            {isExporting ? `${Math.round(exportProgress)}%` : 'Export WAV'}
          </span>
        </button>
      </div>
    </div>
  );
}
