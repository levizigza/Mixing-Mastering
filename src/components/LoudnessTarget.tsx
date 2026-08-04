'use client';

import React, { useState } from 'react';
import { Target, Check, AlertTriangle, XCircle } from 'lucide-react';
import { cn, clamp, mapRange } from '@/lib/utils';
import { ProMeterData } from '@/lib/pro-engine';

interface LoudnessTargetProps {
  meter: ProMeterData;
}

interface Platform {
  id: string;
  name: string;
  lufs: number;
  truePeak: number;   // dBTP
  tolerance: number;  // +/- LUFS
  color: string;
  /**
   * If true, the platform's loudness normalization only attenuates (turns
   * down tracks louder than target). Tracks quieter than target play as-is.
   * This applies to all modern streaming services since ~2020.
   * If false, compliance is strictly bidirectional (e.g. EBU R128 broadcast).
   */
  ceilingOnly: boolean;
}

const PLATFORMS: Platform[] = [
  { id: 'spotify',    name: 'Spotify',              lufs: -14, truePeak: -1,   tolerance: 1, color: '#1DB954', ceilingOnly: true },
  { id: 'apple',      name: 'Apple Music',          lufs: -16, truePeak: -1,   tolerance: 1, color: '#FC3C44', ceilingOnly: true },
  { id: 'youtube',    name: 'YouTube',              lufs: -14, truePeak: -1,   tolerance: 1, color: '#FF0000', ceilingOnly: true },
  { id: 'tidal',      name: 'Tidal',                lufs: -14, truePeak: -1,   tolerance: 1, color: '#00FFFF', ceilingOnly: true },
  { id: 'amazon',     name: 'Amazon Music',         lufs: -14, truePeak: -2,   tolerance: 1, color: '#FF9900', ceilingOnly: true },
  { id: 'soundcloud', name: 'SoundCloud',           lufs: -14, truePeak: -1,   tolerance: 2, color: '#FF5500', ceilingOnly: true },
  { id: 'cd',         name: 'CD Master',            lufs: -9,  truePeak: -0.3, tolerance: 3, color: '#C0C0C0', ceilingOnly: false },
  // EBU R128: long-form programs allow ±1 LU; short-form is ±0.5 LU.
  // Use the more-permissive long-form default to avoid false fails.
  { id: 'broadcast',  name: 'Broadcast (EBU R128)', lufs: -23, truePeak: -1,   tolerance: 1, color: '#4A90D9', ceilingOnly: false },
];

function getStatus(integratedLUFS: number, truePeak: number, platform: Platform) {
  const lufsDiff = integratedLUFS - platform.lufs; // signed
  const lufsOff = Math.abs(lufsDiff);
  const peakOk = truePeak <= platform.truePeak;

  // For ceiling-only streaming platforms, being quieter is acceptable
  // (the platform just won't turn you up). Being louder triggers attenuation.
  let lufsOk: boolean;
  let lufsClose: boolean;
  if (platform.ceilingOnly) {
    lufsOk    = lufsDiff <= platform.tolerance;          // louder than target by <= tol
    lufsClose = lufsDiff <= platform.tolerance * 2;
  } else {
    lufsOk    = lufsOff <= platform.tolerance;           // strict bidirectional
    lufsClose = lufsOff <= platform.tolerance * 2;
  }

  if (lufsOk && peakOk) return 'pass';
  if (lufsClose && peakOk) return 'warn';
  return 'fail';
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'pass') return <Check size={10} className="text-green-400" />;
  if (status === 'warn') return <AlertTriangle size={10} className="text-yellow-400" />;
  return <XCircle size={10} className="text-red-400" />;
}

export default function LoudnessTarget({ meter }: LoudnessTargetProps) {
  const [selectedPlatform, setSelectedPlatform] = useState('spotify');

  const intLUFS = meter.integratedLUFS;
  const truePeak = Math.max(meter.truePeakL, meter.truePeakR);
  const hasData = intLUFS > -Infinity;

  const platform = PLATFORMS.find((p) => p.id === selectedPlatform) || PLATFORMS[0];
  const lufsDiff = hasData ? intLUFS - platform.lufs : 0;
  const status = hasData ? getStatus(intLUFS, truePeak, platform) : 'fail';

  return (
    <div className="studio-panel p-3 space-y-2">
      <h3 className="text-[10px] font-bold text-studio-text uppercase tracking-wider flex items-center gap-1.5">
        <Target size={11} className="text-studio-accent" />
        Loudness Target
      </h3>

      {/* Platform selector */}
      <div className="flex flex-wrap gap-1">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedPlatform(p.id)}
            className={cn(
              'px-1.5 py-0.5 rounded text-[8px] font-mono transition-all border',
              selectedPlatform === p.id
                ? 'border-current text-white'
                : 'text-studio-muted border-transparent hover:text-studio-text'
            )}
            style={selectedPlatform === p.id ? { borderColor: p.color, color: p.color } : undefined}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Target info */}
      <div className="bg-studio-surface rounded p-2 space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-studio-muted">Target LUFS</span>
          <span className="text-[11px] font-mono font-bold" style={{ color: platform.color }}>
            {platform.lufs} LUFS
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-studio-muted">Max True Peak</span>
          <span className="text-[11px] font-mono font-bold" style={{ color: platform.color }}>
            {platform.truePeak} dBTP
          </span>
        </div>
      </div>

      {/* Current vs target */}
      {hasData && (
        <div className="bg-studio-surface rounded p-2 space-y-2">
          {/* LUFS bar */}
          <div className="space-y-0.5">
            <div className="flex justify-between">
              <span className="text-[9px] font-mono text-studio-muted">Integrated</span>
              <div className="flex items-center gap-1">
                <StatusIcon status={status} />
                <span className={cn(
                  'text-[10px] font-mono tabular-nums',
                  status === 'pass' ? 'text-green-400' : status === 'warn' ? 'text-yellow-400' : 'text-red-400'
                )}>
                  {intLUFS.toFixed(1)} LUFS
                </span>
              </div>
            </div>

            {/* Visual bar showing where you are relative to target */}
            <div className="relative h-3 bg-white/5 rounded-full overflow-hidden">
              {/* Target zone */}
              <div
                className="absolute top-0 bottom-0 opacity-20 rounded-full"
                style={{
                  left: `${clamp(mapRange(platform.lufs - platform.tolerance, -40, 0, 0, 100), 0, 100)}%`,
                  right: `${100 - clamp(mapRange(platform.lufs + platform.tolerance, -40, 0, 0, 100), 0, 100)}%`,
                  backgroundColor: platform.color,
                }}
              />
              {/* Target line */}
              <div
                className="absolute top-0 bottom-0 w-0.5"
                style={{
                  left: `${clamp(mapRange(platform.lufs, -40, 0, 0, 100), 0, 100)}%`,
                  backgroundColor: platform.color,
                }}
              />
              {/* Current position */}
              <div
                className="absolute top-0 h-full w-2 rounded-full transition-all duration-300"
                style={{
                  left: `${clamp(mapRange(intLUFS, -40, 0, 0, 100), 0, 100)}%`,
                  backgroundColor: status === 'pass' ? '#22c55e' : status === 'warn' ? '#eab308' : '#ef4444',
                  boxShadow: `0 0 4px ${status === 'pass' ? '#22c55e' : status === 'warn' ? '#eab308' : '#ef4444'}`,
                }}
              />
            </div>

            {/* Difference */}
            <div className="text-center">
              <span className={cn(
                'text-[9px] font-mono',
                Math.abs(lufsDiff) <= platform.tolerance ? 'text-green-400' : 'text-yellow-400'
              )}>
                {lufsDiff > 0 ? '+' : ''}{lufsDiff.toFixed(1)} LU from target
              </span>
            </div>
          </div>

          {/* True peak check */}
          <div className="flex justify-between items-center">
            <span className="text-[9px] font-mono text-studio-muted">True Peak</span>
            <div className="flex items-center gap-1">
              {truePeak <= platform.truePeak ? (
                <Check size={9} className="text-green-400" />
              ) : (
                <XCircle size={9} className="text-red-400" />
              )}
              <span className={cn(
                'text-[9px] font-mono tabular-nums',
                truePeak <= platform.truePeak ? 'text-green-400' : 'text-red-400'
              )}>
                {truePeak > -Infinity ? `${truePeak.toFixed(1)} dBTP` : '-∞'}
              </span>
            </div>
          </div>

          {/* Recommendation */}
          {status !== 'pass' && (
            <div className="text-[8px] font-mono text-studio-muted bg-white/5 rounded p-1.5">
              {lufsDiff > platform.tolerance && (
                <span>Your mix is <b className="text-yellow-400">{lufsDiff.toFixed(1)} LU too loud</b>. Reduce master gain by ~{Math.abs(lufsDiff).toFixed(1)} dB.</span>
              )}
              {lufsDiff < -platform.tolerance && (
                <span>Your mix is <b className="text-yellow-400">{Math.abs(lufsDiff).toFixed(1)} LU too quiet</b>. Increase master gain by ~{Math.abs(lufsDiff).toFixed(1)} dB.</span>
              )}
              {truePeak > platform.truePeak && (
                <span> True peak exceeds limit by <b className="text-red-400">{(truePeak - platform.truePeak).toFixed(1)} dB</b>. Lower the limiter ceiling.</span>
              )}
            </div>
          )}
        </div>
      )}

      {!hasData && (
        <div className="text-[9px] text-studio-muted text-center py-2">
          Play audio to see loudness analysis
        </div>
      )}

      {/* Quick overview of all platforms */}
      <div className="border-t border-studio-border pt-1.5 space-y-0.5">
        <span className="text-[8px] font-mono text-studio-muted">All Platforms</span>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          {PLATFORMS.map((p) => {
            const s = hasData ? getStatus(intLUFS, truePeak, p) : 'fail';
            return (
              <div key={p.id} className="flex items-center gap-1">
                <StatusIcon status={s} />
                <span className="text-[8px] font-mono text-studio-muted">{p.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
