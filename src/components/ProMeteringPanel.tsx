'use client';

import React, { useState } from 'react';
import { ProMeterData } from '@/lib/pro-engine';
import { formatDb, cn, mapRange, clamp } from '@/lib/utils';
import Meter from '@/components/ui/Meter';

interface ProMeteringPanelProps {
  meter: ProMeterData;
}

function LUFSDisplay({ label, value, color }: { label: string; value: number; color: string }) {
  const display = value > -Infinity ? value.toFixed(1) : '-∞';
  return (
    <div className="flex justify-between items-center">
      <span className="text-[9px] font-mono text-studio-muted uppercase">{label}</span>
      <span className="text-xs font-mono tabular-nums" style={{ color }}>
        {display} <span className="text-[8px] text-studio-muted">LUFS</span>
      </span>
    </div>
  );
}

function GRMeter({ label, value }: { label: string; value: number }) {
  const width = clamp(value * 5, 0, 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <span className="text-[9px] font-mono text-studio-muted">{label}</span>
        <span className="text-[9px] font-mono text-studio-orange tabular-nums">
          {value > 0.1 ? `-${value.toFixed(1)} dB` : '0.0 dB'}
        </span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-75"
          style={{
            width: `${width}%`,
            backgroundColor: value > 6 ? '#ef4444' : value > 3 ? '#f97316' : '#eab308',
          }}
        />
      </div>
    </div>
  );
}

function PhaseCorrelationMeter({ value }: { value: number }) {
  // -1 (out of phase) to +1 (in phase)
  const position = clamp(mapRange(value, -1, 1, 0, 100), 0, 100);
  const color = value > 0.5 ? '#22c55e' : value > 0 ? '#eab308' : '#ef4444';

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <span className="text-[9px] font-mono text-studio-muted">PHASE</span>
        <span className="text-[9px] font-mono tabular-nums" style={{ color }}>
          {value.toFixed(2)}
        </span>
      </div>
      <div className="relative h-2 bg-white/5 rounded-full overflow-hidden">
        {/* Center mark */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
        {/* -1 and +1 labels */}
        <div className="absolute left-0.5 top-1/2 -translate-y-1/2 text-[7px] font-mono text-studio-muted">-1</div>
        <div className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[7px] font-mono text-studio-muted">+1</div>
        {/* Indicator */}
        <div
          className="absolute top-0 h-full w-1.5 rounded-full transition-all duration-100"
          style={{
            left: `calc(${position}% - 3px)`,
            backgroundColor: color,
            boxShadow: `0 0 4px ${color}`,
          }}
        />
      </div>
    </div>
  );
}

function BandDisplay({ levels, gainReduction }: { levels: number[]; gainReduction: number[] }) {
  const labels = ['SUB', 'LOW', 'MID', 'HIGH'];
  const colors = ['#6366f1', '#22c55e', '#eab308', '#ef4444'];

  return (
    <div className="space-y-1">
      <span className="text-[9px] font-mono text-studio-muted uppercase">Multiband</span>
      <div className="flex gap-1">
        {labels.map((label, i) => {
          const level = levels[i] > 0 ? 20 * Math.log10(levels[i]) : -60;
          const normalized = clamp(mapRange(level, -60, 0, 0, 100), 0, 100);
          const gr = gainReduction[i] || 0;

          return (
            <div key={label} className="flex-1 space-y-0.5">
              <div className="h-12 bg-white/5 rounded relative overflow-hidden">
                <div
                  className="absolute bottom-0 left-0 right-0 rounded transition-all duration-75"
                  style={{
                    height: `${normalized}%`,
                    backgroundColor: colors[i],
                    opacity: 0.6,
                  }}
                />
                {gr > 0.5 && (
                  <div
                    className="absolute top-0 left-0 right-0 bg-red-500/30"
                    style={{ height: `${clamp(gr * 4, 0, 100)}%` }}
                  />
                )}
              </div>
              <span className="text-[7px] font-mono text-studio-muted text-center block">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type KSystem = 'K-20' | 'K-14' | 'K-12';
const K_OFFSETS: Record<KSystem, number> = { 'K-20': 20, 'K-14': 14, 'K-12': 12 };

function KMeter({ rmsL, rmsR, kSystem }: { rmsL: number; rmsR: number; kSystem: KSystem }) {
  const offset = K_OFFSETS[kSystem];
  // K-System: 0 dB on K-meter = -offset dBFS (e.g. K-20: 0 = -20 dBFS)
  const kL = rmsL > -Infinity ? rmsL + offset : -Infinity;
  const kR = rmsR > -Infinity ? rmsR + offset : -Infinity;
  const scaleMarks = [-20, -14, -10, -6, -3, 0, 3, 6, 9, 12];

  const barHeight = (kVal: number) => clamp(mapRange(kVal, -20, 12, 0, 100), 0, 100);
  const barColor = (kVal: number) => kVal > 0 ? '#ef4444' : kVal > -6 ? '#eab308' : '#22c55e';

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[9px] font-mono text-studio-muted">{kSystem} METER</span>
        <span className="text-[9px] font-mono text-studio-muted">0 dB = {-offset} dBFS</span>
      </div>
      <div className="flex gap-1 items-end h-16">
        {/* Scale */}
        <div className="relative h-full w-6 shrink-0">
          {scaleMarks.map((mark) => {
            const bottom = mapRange(mark, -20, 12, 0, 100);
            if (bottom < 0 || bottom > 100) return null;
            return (
              <span
                key={mark}
                className="absolute right-0 text-[6px] font-mono text-studio-muted leading-none"
                style={{ bottom: `${bottom}%`, transform: 'translateY(50%)' }}
              >
                {mark > 0 ? `+${mark}` : mark}
              </span>
            );
          })}
        </div>
        {/* L bar */}
        <div className="flex-1 h-full bg-white/5 rounded relative overflow-hidden">
          <div
            className="absolute bottom-0 left-0 right-0 rounded transition-all duration-75"
            style={{ height: `${barHeight(kL)}%`, backgroundColor: barColor(kL), opacity: 0.7 }}
          />
          {/* 0 dB line */}
          <div className="absolute left-0 right-0 h-px bg-white/50" style={{ bottom: `${mapRange(0, -20, 12, 0, 100)}%` }} />
          <span className="absolute bottom-0.5 left-0.5 text-[6px] font-mono text-white/40">L</span>
        </div>
        {/* R bar */}
        <div className="flex-1 h-full bg-white/5 rounded relative overflow-hidden">
          <div
            className="absolute bottom-0 left-0 right-0 rounded transition-all duration-75"
            style={{ height: `${barHeight(kR)}%`, backgroundColor: barColor(kR), opacity: 0.7 }}
          />
          <div className="absolute left-0 right-0 h-px bg-white/50" style={{ bottom: `${mapRange(0, -20, 12, 0, 100)}%` }} />
          <span className="absolute bottom-0.5 left-0.5 text-[6px] font-mono text-white/40">R</span>
        </div>
      </div>
      <div className="flex justify-between">
        <span className="text-[8px] font-mono tabular-nums" style={{ color: barColor(kL) }}>
          {kL > -Infinity ? `${kL.toFixed(1)}` : '-∞'}
        </span>
        <span className="text-[8px] font-mono tabular-nums" style={{ color: barColor(kR) }}>
          {kR > -Infinity ? `${kR.toFixed(1)}` : '-∞'}
        </span>
      </div>
    </div>
  );
}

function LRADisplay({ shortTerm, integrated }: { shortTerm: number; integrated: number }) {
  // LRA approximation: difference between short-term and integrated gives a sense of dynamic range
  const lra = (shortTerm > -Infinity && integrated > -Infinity)
    ? Math.abs(shortTerm - integrated)
    : 0;
  const lraColor = lra > 15 ? '#ef4444' : lra > 10 ? '#eab308' : lra > 5 ? '#22c55e' : '#6366f1';
  const lraLabel = lra > 15 ? 'Very Wide' : lra > 10 ? 'Wide' : lra > 5 ? 'Normal' : 'Narrow';

  return (
    <div className="flex justify-between items-center">
      <span className="text-[9px] font-mono text-studio-muted">LRA</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] font-mono" style={{ color: lraColor }}>{lraLabel}</span>
        <span className="text-[10px] font-mono tabular-nums font-bold" style={{ color: lraColor }}>
          {lra > 0 ? `${lra.toFixed(1)} LU` : '—'}
        </span>
      </div>
    </div>
  );
}

export default function ProMeteringPanel({ meter }: ProMeteringPanelProps) {
  const [kSystem, setKSystem] = useState<KSystem>('K-14');

  return (
    <div className="studio-panel p-3 space-y-2.5">
      <h3 className="text-[10px] font-bold text-studio-text uppercase tracking-wider">
        Pro Metering
      </h3>

      {/* K-System selector */}
      <div className="flex gap-1">
        {(['K-12', 'K-14', 'K-20'] as KSystem[]).map((k) => (
          <button
            key={k}
            onClick={() => setKSystem(k)}
            className={cn(
              'flex-1 px-1 py-0.5 rounded text-[8px] font-mono font-medium transition-all border',
              kSystem === k
                ? 'bg-studio-accent text-white border-studio-accent'
                : 'text-studio-muted border-studio-border hover:text-studio-text'
            )}
          >
            {k}
          </button>
        ))}
      </div>

      {/* K-System Meter */}
      <div className="bg-studio-surface rounded p-2">
        <KMeter rmsL={meter.rmsL} rmsR={meter.rmsR} kSystem={kSystem} />
      </div>

      {/* Loudness */}
      <div className="space-y-1 bg-studio-surface rounded p-2">
        <LUFSDisplay label="Momentary" value={meter.momentaryLUFS} color="#22c55e" />
        <LUFSDisplay label="Short-term" value={meter.shortTermLUFS} color="#eab308" />
        <LUFSDisplay label="Integrated" value={meter.integratedLUFS} color="#6366f1" />
        <LRADisplay shortTerm={meter.shortTermLUFS} integrated={meter.integratedLUFS} />
      </div>

      {/* True Peak */}
      <div className="space-y-1 bg-studio-surface rounded p-2">
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-studio-muted">TRUE PEAK L</span>
          <span className={cn(
            'text-[10px] font-mono tabular-nums',
            meter.truePeakL > -1 ? 'text-red-400' : meter.truePeakL > -6 ? 'text-yellow-400' : 'text-green-400'
          )}>
            {meter.truePeakL > -Infinity ? `${meter.truePeakL.toFixed(1)} dBTP` : '-∞'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-studio-muted">TRUE PEAK R</span>
          <span className={cn(
            'text-[10px] font-mono tabular-nums',
            meter.truePeakR > -1 ? 'text-red-400' : meter.truePeakR > -6 ? 'text-yellow-400' : 'text-green-400'
          )}>
            {meter.truePeakR > -Infinity ? `${meter.truePeakR.toFixed(1)} dBTP` : '-∞'}
          </span>
        </div>
      </div>

      {/* Gain Reduction */}
      <div className="space-y-1.5 bg-studio-surface rounded p-2">
        <GRMeter label="COMP GR" value={meter.compressorGR} />
        <GRMeter label="LIMIT GR" value={meter.limiterGR} />
      </div>

      {/* Phase Correlation */}
      <div className="bg-studio-surface rounded p-2">
        <PhaseCorrelationMeter value={meter.phaseCorrelation} />
      </div>

      {/* Multiband Levels */}
      <div className="bg-studio-surface rounded p-2">
        <BandDisplay levels={meter.bandLevels} gainReduction={meter.bandGR} />
      </div>
    </div>
  );
}
