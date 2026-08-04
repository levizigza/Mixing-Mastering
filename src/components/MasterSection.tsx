'use client';

import React from 'react';
import { MasterProcessing, MeterData } from '@/types/audio';
import Knob from '@/components/ui/Knob';
import Slider from '@/components/ui/Slider';
import Meter from '@/components/ui/Meter';
import Toggle from '@/components/ui/Toggle';
import { formatDb } from '@/lib/utils';

interface MasterSectionProps {
  processing: MasterProcessing;
  meter: MeterData;
  onUpdate: (processing: Partial<MasterProcessing>) => void;
}

export default function MasterSection({ processing, meter, onUpdate }: MasterSectionProps) {
  return (
    <div className="studio-panel p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-studio-text">Master Bus</h3>
        <Toggle
          active={processing.bypass}
          label="BYPASS"
          activeColor="#64748b"
          size="md"
          onChange={(v) => onUpdate({ bypass: v })}
        />
      </div>

      {/* Master EQ */}
      <div className="space-y-1">
        <span className="studio-label">EQ</span>
        <div className="flex gap-3 justify-center">
          {processing.eq.map((band, i) => (
            <Knob
              key={i}
              value={band.gain}
              min={-12}
              max={12}
              step={0.5}
              label={i === 0 ? 'Low' : i === 1 ? 'Mid' : 'High'}
              unit=" dB"
              size="md"
              color="#6366f1"
              defaultValue={0}
              onChange={(v) => {
                const newEQ = [...processing.eq];
                newEQ[i] = { ...newEQ[i], gain: v };
                onUpdate({ eq: newEQ });
              }}
            />
          ))}
        </div>
      </div>

      {/* Compressor */}
      <div className="space-y-1">
        <span className="studio-label">Compressor</span>
        <div className="flex gap-2 justify-center">
          <Knob
            value={processing.compressor.threshold}
            min={-60}
            max={0}
            step={1}
            label="Thresh"
            unit=" dB"
            size="sm"
            color="#f97316"
            defaultValue={-12}
            onChange={(v) =>
              onUpdate({ compressor: { ...processing.compressor, threshold: v } })
            }
          />
          <Knob
            value={processing.compressor.ratio}
            min={1}
            max={20}
            step={0.5}
            label="Ratio"
            unit=":1"
            size="sm"
            color="#f97316"
            defaultValue={2}
            onChange={(v) =>
              onUpdate({ compressor: { ...processing.compressor, ratio: v } })
            }
          />
          <Knob
            value={processing.compressor.attack * 1000}
            min={0.1}
            max={100}
            step={0.1}
            label="Attack"
            unit="ms"
            size="sm"
            color="#f97316"
            defaultValue={3}
            onChange={(v) =>
              onUpdate({
                compressor: { ...processing.compressor, attack: v / 1000 },
              })
            }
          />
          <Knob
            value={processing.compressor.release * 1000}
            min={10}
            max={1000}
            step={10}
            label="Release"
            unit="ms"
            size="sm"
            color="#f97316"
            defaultValue={250}
            onChange={(v) =>
              onUpdate({
                compressor: { ...processing.compressor, release: v / 1000 },
              })
            }
          />
        </div>
      </div>

      {/* Limiter */}
      <div className="space-y-1">
        <span className="studio-label">Limiter</span>
        <div className="flex gap-3 justify-center">
          <Knob
            value={processing.limiter.threshold}
            min={-12}
            max={0}
            step={0.1}
            label="Ceiling"
            unit=" dB"
            size="sm"
            color="#ef4444"
            defaultValue={-1}
            onChange={(v) =>
              onUpdate({ limiter: { ...processing.limiter, threshold: v } })
            }
          />
        </div>
      </div>

      {/* Saturation & Width */}
      <div className="flex gap-4 justify-center">
        <div className="space-y-1">
          <span className="studio-label">Saturation</span>
          <div className="flex gap-2">
            <Knob
              value={processing.saturation.drive}
              min={0}
              max={1}
              step={0.01}
              label="Drive"
              size="sm"
              color="#eab308"
              defaultValue={0}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) =>
                onUpdate({ saturation: { ...processing.saturation, drive: v } })
              }
            />
            <Knob
              value={processing.saturation.mix}
              min={0}
              max={1}
              step={0.01}
              label="Mix"
              size="sm"
              color="#eab308"
              defaultValue={0}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) =>
                onUpdate({ saturation: { ...processing.saturation, mix: v } })
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <span className="studio-label">Width</span>
          <Knob
            value={processing.stereoWidth.width}
            min={0}
            max={2}
            step={0.01}
            label="Stereo"
            size="sm"
            color="#06b6d4"
            defaultValue={1}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onUpdate({ stereoWidth: { width: v } })}
          />
        </div>
      </div>

      {/* Stereo Imager */}
      <div className="space-y-1">
        <span className="studio-label">Stereo Imager</span>
        <div className="flex gap-2 justify-center">
          <Knob
            value={processing.stereoImager.lowWidth}
            min={0}
            max={2}
            step={0.01}
            label="Low"
            size="sm"
            color="#06b6d4"
            defaultValue={0.5}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) =>
              onUpdate({ stereoImager: { ...processing.stereoImager, lowWidth: v } })
            }
          />
          <Knob
            value={processing.stereoImager.midWidth}
            min={0}
            max={2}
            step={0.01}
            label="Mid"
            size="sm"
            color="#06b6d4"
            defaultValue={1.0}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) =>
              onUpdate({ stereoImager: { ...processing.stereoImager, midWidth: v } })
            }
          />
          <Knob
            value={processing.stereoImager.highWidth}
            min={0}
            max={2}
            step={0.01}
            label="High"
            size="sm"
            color="#06b6d4"
            defaultValue={1.3}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) =>
              onUpdate({ stereoImager: { ...processing.stereoImager, highWidth: v } })
            }
          />
          <Knob
            value={processing.stereoImager.bassMonoFreq}
            min={0}
            max={300}
            step={5}
            label="Mono"
            unit=" Hz"
            size="sm"
            color="#06b6d4"
            defaultValue={80}
            onChange={(v) =>
              onUpdate({ stereoImager: { ...processing.stereoImager, bassMonoFreq: v } })
            }
          />
        </div>
      </div>

      {/* Master Fader + Meters */}
      <div className="flex gap-3 items-end justify-center pt-2">
        <Slider
          value={processing.gain}
          min={-60}
          max={12}
          step={0.5}
          label="Master"
          orientation="vertical"
          height={100}
          color="#6366f1"
          defaultValue={0}
          formatValue={(v) => formatDb(v)}
          onChange={(v) => onUpdate({ gain: v })}
        />
        <div className="flex gap-1">
          <Meter value={meter.peakL} peak={meter.peakL} height={100} width={6} label="L" showScale />
          <Meter value={meter.peakR} peak={meter.peakR} height={100} width={6} label="R" />
        </div>
      </div>

      {/* LUFS */}
      <div className="flex justify-between items-center bg-studio-surface rounded px-2 py-1.5">
        <span className="studio-label">LUFS</span>
        <span className="text-xs font-mono text-studio-text tabular-nums">
          {meter.lufs > -Infinity ? meter.lufs.toFixed(1) : '-∞'}
        </span>
        {meter.clipCount > 0 && (
          <span className="text-[10px] font-mono text-red-400 animate-meter-pulse">
            CLIP ({meter.clipCount})
          </span>
        )}
      </div>
    </div>
  );
}
