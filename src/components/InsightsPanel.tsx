'use client';

import React from 'react';
import { AnalysisResult, Stem } from '@/types/audio';
import { formatDb } from '@/lib/utils';
import { Info, TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface InsightsPanelProps {
  stems: Stem[];
}

function analyzeStem(stem: Stem): AnalysisResult {
  let peakLevel = -Infinity;
  let rmsLevel = -Infinity;

  if (stem.audioBuffer) {
    const data = stem.audioBuffer.getChannelData(0);
    let peak = 0;
    let rmsSum = 0;

    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
      rmsSum += data[i] * data[i];
    }

    peakLevel = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    rmsLevel = rmsSum > 0 ? 20 * Math.log10(Math.sqrt(rmsSum / data.length)) : -Infinity;
  }

  const dynamicRange = peakLevel - rmsLevel;

  return {
    stemId: stem.id,
    stemName: stem.name,
    stemType: stem.type,
    peakLevel,
    rmsLevel,
    dynamicRange: isFinite(dynamicRange) ? dynamicRange : 0,
    processing: stem.processing,
  };
}

function describeProcessing(analysis: AnalysisResult): string[] {
  const notes: string[] = [];
  const p = analysis.processing;

  const eqChanges = p.eq.filter((b) => Math.abs(b.gain) > 0.5);
  if (eqChanges.length > 0) {
    const eqDesc = eqChanges
      .map((b) => {
        const freq =
          b.frequency >= 1000
            ? `${(b.frequency / 1000).toFixed(1)}kHz`
            : `${b.frequency}Hz`;
        return `${b.gain > 0 ? '+' : ''}${b.gain.toFixed(1)}dB @ ${freq}`;
      })
      .join(', ');
    notes.push(`EQ: ${eqDesc}`);
  }

  if (p.compressor.threshold > -60 && p.compressor.ratio > 1) {
    notes.push(
      `Compression: ${p.compressor.threshold}dB threshold, ${p.compressor.ratio}:1 ratio`
    );
  }

  if (p.saturation.drive > 0) {
    notes.push(
      `Saturation: ${Math.round(p.saturation.drive * 100)}% drive, ${Math.round(p.saturation.mix * 100)}% mix`
    );
  }

  if (Math.abs(p.gain) > 0.5) {
    notes.push(`Gain: ${p.gain > 0 ? '+' : ''}${p.gain.toFixed(1)} dB`);
  }

  if (Math.abs(p.pan) > 0.05) {
    const dir = p.pan < 0 ? 'Left' : 'Right';
    notes.push(`Pan: ${dir} ${Math.round(Math.abs(p.pan) * 100)}%`);
  }

  if (p.mute) notes.push('Muted');
  if (p.solo) notes.push('Soloed');
  if (p.bypass) notes.push('Bypassed');

  return notes.length > 0 ? notes : ['No processing applied'];
}

export default function InsightsPanel({ stems }: InsightsPanelProps) {
  if (stems.length === 0) {
    return (
      <div className="studio-panel p-4">
        <h3 className="text-sm font-semibold text-studio-text flex items-center gap-2">
          <Info size={14} />
          Insights
        </h3>
        <p className="text-xs text-studio-muted mt-2">
          Upload stems to see per-track analysis and processing details.
        </p>
      </div>
    );
  }

  const analyses = stems.map(analyzeStem);

  return (
    <div className="studio-panel p-4 space-y-3">
      <h3 className="text-sm font-semibold text-studio-text flex items-center gap-2">
        <Activity size={14} />
        Per-Stem Insights
      </h3>

      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {analyses.map((analysis) => (
          <div
            key={analysis.stemId}
            className="bg-studio-surface rounded-md p-2.5 space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-studio-text">
                {analysis.stemName}
              </span>
              <span className="studio-label">{analysis.stemType}</span>
            </div>

            <div className="flex gap-3">
              <div className="flex items-center gap-1">
                <TrendingUp size={10} className="text-studio-green" />
                <span className="text-[10px] font-mono text-studio-text-dim">
                  Peak: {formatDb(analysis.peakLevel)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingDown size={10} className="text-studio-cyan" />
                <span className="text-[10px] font-mono text-studio-text-dim">
                  RMS: {formatDb(analysis.rmsLevel)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Activity size={10} className="text-studio-yellow" />
                <span className="text-[10px] font-mono text-studio-text-dim">
                  DR: {analysis.dynamicRange.toFixed(1)} dB
                </span>
              </div>
            </div>

            <div className="space-y-0.5">
              {describeProcessing(analysis).map((note, i) => (
                <p key={i} className="text-[10px] text-studio-muted">
                  • {note}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
