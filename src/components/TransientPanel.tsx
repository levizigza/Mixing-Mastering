'use client';

import React, { useState, useCallback } from 'react';
import { Zap } from 'lucide-react';
import Knob from '@/components/ui/Knob';

interface TransientPanelProps {
  stemId: string | null;
  onUpdateTransient: (stemId: string, params: Record<string, number>) => void;
  onUpdateGate: (stemId: string, params: Record<string, number>) => void;
}

export default function TransientPanel({
  stemId,
  onUpdateTransient,
  onUpdateGate,
}: TransientPanelProps) {
  // Transient designer
  const [attack, setAttack] = useState(0);
  const [sustain, setSustain] = useState(0);
  const [speed, setSpeed] = useState(50);
  // Gate
  const [gateThreshold, setGateThreshold] = useState(-80);
  const [gateHold, setGateHold] = useState(50);
  const [gateRelease, setGateRelease] = useState(100);
  const [gateEnabled, setGateEnabled] = useState(false);

  if (!stemId) return null;

  const syncTransient = (key: string, value: number) => {
    const params: Record<string, number> = { attack, sustain, speed, mix: 1 };
    params[key] = value;
    onUpdateTransient(stemId, params);
  };

  const syncGate = (key: string, value: number) => {
    const params: Record<string, number> = {
      threshold: gateThreshold,
      hold: gateHold / 1000,
      release: gateRelease / 1000,
      ratio: 100, // hard gate
      range: -80,
    };
    if (key === 'hold') params.hold = value / 1000;
    else if (key === 'release') params.release = value / 1000;
    else params[key] = value;
    onUpdateGate(stemId, params);
  };

  return (
    <div className="studio-panel p-3 space-y-2">
      <h3 className="text-[10px] font-bold text-studio-text uppercase tracking-wider flex items-center gap-1.5">
        <Zap size={11} className="text-yellow-400" />
        Transient / Gate
      </h3>

      {/* Transient Designer */}
      <div className="space-y-1">
        <span className="text-[9px] font-mono text-studio-muted uppercase">Transient Shaper</span>
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center">
            <Knob
              value={attack}
              label="Attack"
              min={-24}
              max={24}
              defaultValue={0}
              size="sm"
              onChange={(v) => { setAttack(v); syncTransient('attack', v); }}
            />
            <span className="studio-label mt-0.5">Attack</span>
            <span className="text-[8px] font-mono text-studio-muted">{attack > 0 ? '+' : ''}{attack.toFixed(1)} dB</span>
          </div>
          <div className="flex flex-col items-center">
            <Knob
              value={sustain}
              label="Sustain"
              min={-24}
              max={24}
              defaultValue={0}
              size="sm"
              onChange={(v) => { setSustain(v); syncTransient('sustain', v); }}
            />
            <span className="studio-label mt-0.5">Sustain</span>
            <span className="text-[8px] font-mono text-studio-muted">{sustain > 0 ? '+' : ''}{sustain.toFixed(1)} dB</span>
          </div>
          <div className="flex flex-col items-center">
            <Knob
              value={speed}
              label="Speed"
              min={1}
              max={200}
              defaultValue={50}
              size="sm"
              onChange={(v) => { setSpeed(v); syncTransient('speed', v); }}
            />
            <span className="studio-label mt-0.5">Speed</span>
            <span className="text-[8px] font-mono text-studio-muted">{speed.toFixed(0)} ms</span>
          </div>
        </div>
      </div>

      {/* Gate */}
      <div className="border-t border-studio-border pt-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-mono text-studio-muted uppercase">Gate / Expander</span>
          <button
            onClick={() => {
              const next = !gateEnabled;
              setGateEnabled(next);
              if (!next) {
                onUpdateGate(stemId, { threshold: -80, ratio: 1, range: 0 });
              } else {
                syncGate('threshold', gateThreshold);
              }
            }}
            className={`text-[8px] px-1.5 py-0.5 rounded border transition-all ${
              gateEnabled
                ? 'border-green-500 text-green-400 bg-green-500/10'
                : 'border-studio-border text-studio-muted'
            }`}
          >
            {gateEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        {gateEnabled && (
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col items-center">
              <Knob
                value={gateThreshold}
                label="Thresh"
                min={-80}
                max={0}
                defaultValue={-40}
                size="sm"
                onChange={(v) => { setGateThreshold(v); syncGate('threshold', v); }}
              />
              <span className="studio-label mt-0.5">Thresh</span>
              <span className="text-[8px] font-mono text-studio-muted">{gateThreshold} dB</span>
            </div>
            <div className="flex flex-col items-center">
              <Knob
                value={gateHold}
                label="Hold"
                min={0}
                max={500}
                defaultValue={50}
                size="sm"
                onChange={(v) => { setGateHold(v); syncGate('hold', v); }}
              />
              <span className="studio-label mt-0.5">Hold</span>
              <span className="text-[8px] font-mono text-studio-muted">{gateHold} ms</span>
            </div>
            <div className="flex flex-col items-center">
              <Knob
                value={gateRelease}
                label="Release"
                min={5}
                max={2000}
                defaultValue={100}
                size="sm"
                onChange={(v) => { setGateRelease(v); syncGate('release', v); }}
              />
              <span className="studio-label mt-0.5">Release</span>
              <span className="text-[8px] font-mono text-studio-muted">{gateRelease} ms</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
