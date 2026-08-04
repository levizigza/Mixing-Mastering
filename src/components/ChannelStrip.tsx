'use client';

import React, { useState } from 'react';
import { Trash2, Volume2, VolumeX, GripVertical, Copy, Download } from 'lucide-react';
import { cn, formatDb } from '@/lib/utils';
import { Stem, StemProcessing, StemType, TrackRole } from '@/types/audio';
import Knob from '@/components/ui/Knob';
import Slider from '@/components/ui/Slider';
import Meter from '@/components/ui/Meter';
import Toggle from '@/components/ui/Toggle';

interface ChannelStripProps {
  stem: Stem;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (processing: Partial<StemProcessing>) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onExportStem?: () => void;
  onTrackRoleChange?: (role: TrackRole) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  meterValue: number;
}

const typeColors: Record<StemType, string> = {
  vocals: '#6366f1',
  drums: '#f97316',
  bass: '#22c55e',
  instruments: '#eab308',
  fx: '#06b6d4',
  fullmix: '#a855f7',
};

export default function ChannelStrip({
  stem,
  isSelected,
  onSelect,
  onUpdate,
  onRemove,
  onDuplicate,
  onExportStem,
  onTrackRoleChange,
  onDragStart,
  onDragOver,
  onDrop,
  meterValue,
}: ChannelStripProps) {
  const color = typeColors[stem.type];
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
    <div
      className={cn(
        'studio-panel flex flex-col items-center gap-2 p-3 w-[90px] min-h-0 cursor-pointer transition-all',
        isSelected && 'ring-1 ring-studio-accent'
      )}
      onClick={onSelect}
      onContextMenu={handleContextMenu}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Drag handle */}
      <div className="w-full flex items-center justify-center text-studio-muted/40 hover:text-studio-muted cursor-grab active:cursor-grabbing">
        <GripVertical size={10} />
      </div>

      {/* Name */}
      <div className="w-full text-center">
        <div
          className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {stem.type}
        </div>
        <div className="text-[10px] text-studio-text-dim truncate mt-0.5" title={stem.name}>
          {stem.name}
        </div>
        {onTrackRoleChange && (
          <div className="flex gap-0.5 mt-1 justify-center">
            {(['music', 'dialogue', 'sfx'] as TrackRole[]).map((role) => (
              <button
                key={role}
                type="button"
                title={role}
                onClick={(e) => {
                  e.stopPropagation();
                  onTrackRoleChange(role);
                }}
                className={cn(
                  'text-[7px] font-mono px-1 rounded border uppercase',
                  stem.trackRole === role
                    ? 'border-amber-500/50 text-amber-300 bg-amber-500/10'
                    : 'border-studio-border text-studio-muted'
                )}
              >
                {role === 'music' ? 'M' : role === 'dialogue' ? 'D' : 'X'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* EQ Knobs */}
      <div className="flex gap-0.5">
        {stem.processing.eq.map((band, i) => (
          <Knob
            key={i}
            value={band.gain}
            min={-12}
            max={12}
            step={0.5}
            label={i === 0 ? 'Lo' : i === 1 ? 'Mid' : 'Hi'}
            unit=" dB"
            size="sm"
            color={color}
            defaultValue={0}
            onChange={(v) => {
              const newEQ = [...stem.processing.eq];
              newEQ[i] = { ...newEQ[i], gain: v };
              onUpdate({ eq: newEQ });
            }}
          />
        ))}
      </div>

      {/* Compressor */}
      <Knob
        value={stem.processing.compressor.threshold}
        min={-60}
        max={0}
        step={1}
        label="Comp"
        unit=" dB"
        size="sm"
        color={color}
        defaultValue={-24}
        onChange={(v) =>
          onUpdate({
            compressor: { ...stem.processing.compressor, threshold: v },
          })
        }
      />

      {/* Pan */}
      <Knob
        value={stem.processing.pan}
        min={-1}
        max={1}
        step={0.01}
        label="Pan"
        size="sm"
        color={color}
        defaultValue={0}
        formatValue={(v) => {
          if (Math.abs(v) < 0.02) return 'C';
          return v < 0 ? `L${Math.round(Math.abs(v) * 100)}` : `R${Math.round(v * 100)}`;
        }}
        onChange={(v) => onUpdate({ pan: v })}
      />

      {/* Fader + Meter */}
      <div className="flex gap-2 items-end">
        <Slider
          value={stem.processing.gain}
          min={-60}
          max={12}
          step={0.5}
          orientation="vertical"
          height={80}
          color={color}
          defaultValue={0}
          formatValue={(v) => formatDb(v)}
          onChange={(v) => onUpdate({ gain: v })}
        />
        <Meter value={meterValue} height={80} width={4} />
      </div>

      {/* Controls */}
      <div className="flex gap-1 w-full">
        <Toggle
          active={stem.processing.mute}
          label="M"
          activeColor="#ef4444"
          onChange={(v) => onUpdate({ mute: v })}
        />
        <Toggle
          active={stem.processing.solo}
          label="S"
          activeColor="#eab308"
          onChange={(v) => onUpdate({ solo: v })}
        />
        <Toggle
          active={stem.processing.bypass}
          label="B"
          activeColor="#64748b"
          onChange={(v) => onUpdate({ bypass: v })}
        />
      </div>

      {/* Remove */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="text-studio-muted hover:text-red-400 transition-colors"
      >
        <Trash2 size={12} />
      </button>
    </div>

    {/* Context Menu */}
    {contextMenu && (
      <>
      <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
      <div
        className="fixed z-50 bg-studio-panel border border-studio-border rounded-lg shadow-2xl py-1 min-w-[140px] animate-fade-in"
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        <button
          onClick={() => { onUpdate({ mute: !stem.processing.mute }); setContextMenu(null); }}
          className="w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-white/5 flex items-center gap-2 text-studio-text"
        >
          {stem.processing.mute ? <Volume2 size={11} /> : <VolumeX size={11} />}
          {stem.processing.mute ? 'Unmute' : 'Mute'}
        </button>
        <button
          onClick={() => { onUpdate({ solo: !stem.processing.solo }); setContextMenu(null); }}
          className="w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-white/5 flex items-center gap-2 text-yellow-400"
        >
          S
          {stem.processing.solo ? ' Unsolo' : ' Solo'}
        </button>
        <button
          onClick={() => { onUpdate({ bypass: !stem.processing.bypass }); setContextMenu(null); }}
          className="w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-white/5 flex items-center gap-2 text-studio-muted"
        >
          B
          {stem.processing.bypass ? ' Enable FX' : ' Bypass FX'}
        </button>
        <div className="h-px bg-studio-border my-1" />
        {onDuplicate && (
          <button
            onClick={() => { onDuplicate(); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-white/5 flex items-center gap-2 text-studio-text"
          >
            <Copy size={11} />
            Duplicate
          </button>
        )}
        {onExportStem && (
          <button
            onClick={() => { onExportStem(); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-white/5 flex items-center gap-2 text-studio-text"
          >
            <Download size={11} />
            Export Stem
          </button>
        )}
        <div className="h-px bg-studio-border my-1" />
        <button
          onClick={() => { onRemove(); setContextMenu(null); }}
          className="w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-white/5 flex items-center gap-2 text-red-400"
        >
          <Trash2 size={11} />
          Remove
        </button>
      </div>
      </>
    )}
    </>
  );
}
