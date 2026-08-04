'use client';

import React, { useState } from 'react';
import { Link2, Link2Off, ChevronDown } from 'lucide-react';
import { Stem } from '@/types/audio';
import { cn } from '@/lib/utils';
import Knob from '@/components/ui/Knob';

interface SidechainPanelProps {
  stems: Stem[];
  selectedStemId: string | null;
  sidechainRoutes: Record<string, string>;
  onConnect: (sourceId: string, targetId: string) => void;
  onDisconnect: (targetId: string) => void;
  onUpdateParams: (targetId: string, params: Record<string, number>) => void;
}

export default function SidechainPanel({
  stems,
  selectedStemId,
  sidechainRoutes,
  onConnect,
  onDisconnect,
  onUpdateParams,
}: SidechainPanelProps) {
  const [threshold, setThreshold] = useState(-24);
  const [ratio, setRatio] = useState(4);
  const [attack, setAttack] = useState(3);
  const [release, setRelease] = useState(250);
  const [range, setRange] = useState(-40);
  const [mix, setMix] = useState(100);

  if (!selectedStemId) return null;

  const currentSource = sidechainRoutes[selectedStemId];
  const currentStem = stems.find((s) => s.id === selectedStemId);
  const availableSources = stems.filter((s) => s.id !== selectedStemId);

  if (stems.length < 2) return null;

  const handleSourceChange = (sourceId: string) => {
    if (sourceId === '') {
      onDisconnect(selectedStemId);
    } else {
      onConnect(sourceId, selectedStemId);
      onUpdateParams(selectedStemId, {
        threshold,
        ratio,
        attack: attack / 1000,
        release: release / 1000,
        range,
        mix: mix / 100,
      });
    }
  };

  const syncParams = (key: string, value: number) => {
    const params: Record<string, number> = {
      threshold,
      ratio,
      attack: attack / 1000,
      release: release / 1000,
      range,
      mix: mix / 100,
    };
    if (key === 'attack') params.attack = value / 1000;
    else if (key === 'release') params.release = value / 1000;
    else if (key === 'mix') params.mix = value / 100;
    else params[key] = value;

    onUpdateParams(selectedStemId, params);
  };

  return (
    <div className="studio-panel p-3 space-y-2">
      <h3 className="text-[10px] font-bold text-studio-text uppercase tracking-wider flex items-center gap-1.5">
        <Link2 size={11} className="text-studio-accent" />
        Sidechain Compressor
      </h3>

      <div className="text-[9px] text-studio-muted">
        Target: <span className="text-studio-text">{currentStem?.name || 'None'}</span>
      </div>

      {/* Source selector */}
      <div className="space-y-1">
        <span className="studio-label">Key Input (Source)</span>
        <div className="relative">
          <select
            value={currentSource || ''}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="w-full bg-studio-surface border border-studio-border rounded px-2 py-1.5 text-[10px] font-mono text-studio-text appearance-none cursor-pointer focus:outline-none focus:border-studio-accent"
          >
            <option value="">None (disabled)</option>
            {availableSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.type})
              </option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-studio-muted pointer-events-none" />
        </div>
      </div>

      {/* Status */}
      {currentSource ? (
        <div className="flex items-center gap-1.5 text-[9px]">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-green-400 font-mono">
            {stems.find((s) => s.id === currentSource)?.name} → {currentStem?.name}
          </span>
          <button
            onClick={() => onDisconnect(selectedStemId)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <Link2Off size={10} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[9px] text-studio-muted">
          <div className="w-1.5 h-1.5 rounded-full bg-studio-border" />
          No sidechain active
        </div>
      )}

      {/* Parameters (only show when connected) */}
      {currentSource && (
        <div className="space-y-2 pt-1 border-t border-studio-border">
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col items-center">
              <Knob
                value={threshold}
                label="Thresh"
                min={-60}
                max={0}
                defaultValue={-24}
                size="sm"
                onChange={(v) => { setThreshold(v); syncParams('threshold', v); }}
              />
              <span className="studio-label mt-0.5">Thresh</span>
              <span className="text-[8px] font-mono text-studio-muted">{threshold} dB</span>
            </div>
            <div className="flex flex-col items-center">
              <Knob
                value={ratio}
                label="Ratio"
                min={1}
                max={20}
                defaultValue={4}
                size="sm"
                onChange={(v) => { setRatio(v); syncParams('ratio', v); }}
              />
              <span className="studio-label mt-0.5">Ratio</span>
              <span className="text-[8px] font-mono text-studio-muted">{ratio}:1</span>
            </div>
            <div className="flex flex-col items-center">
              <Knob
                value={mix}
                label="Mix"
                min={0}
                max={100}
                defaultValue={100}
                size="sm"
                onChange={(v) => { setMix(v); syncParams('mix', v); }}
              />
              <span className="studio-label mt-0.5">Mix</span>
              <span className="text-[8px] font-mono text-studio-muted">{mix}%</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col items-center">
              <Knob
                value={attack}
                label="Attack"
                min={0.1}
                max={100}
                defaultValue={3}
                size="sm"
                onChange={(v) => { setAttack(v); syncParams('attack', v); }}
              />
              <span className="studio-label mt-0.5">Attack</span>
              <span className="text-[8px] font-mono text-studio-muted">{attack.toFixed(1)} ms</span>
            </div>
            <div className="flex flex-col items-center">
              <Knob
                value={release}
                label="Release"
                min={5}
                max={2000}
                defaultValue={250}
                size="sm"
                onChange={(v) => { setRelease(v); syncParams('release', v); }}
              />
              <span className="studio-label mt-0.5">Release</span>
              <span className="text-[8px] font-mono text-studio-muted">{release.toFixed(0)} ms</span>
            </div>
            <div className="flex flex-col items-center">
              <Knob
                value={range}
                label="Range"
                min={-80}
                max={0}
                defaultValue={-40}
                size="sm"
                onChange={(v) => { setRange(v); syncParams('range', v); }}
              />
              <span className="studio-label mt-0.5">Range</span>
              <span className="text-[8px] font-mono text-studio-muted">{range} dB</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
