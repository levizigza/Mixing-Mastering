'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Lightbulb,
  Info,
  BarChart3,
  Radio,
  Volume2,
  Activity,
  Gauge,
  Mic,
  Drum,
  Guitar,
  Music,
  X,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDb } from '@/lib/utils';
import { TrackAnalysis, MasteringRecommendation, AutoMixResult, QuickMasterResult } from '@/lib/auto-mix';

interface AutoMasterReportProps {
  analysis: TrackAnalysis;
  recommendations: MasteringRecommendation[];
  trackName: string;
  separatedStemAnalysis?: AutoMixResult['analysis'];
  masteringStats?: QuickMasterResult['masteringStats'];
  onDismiss?: () => void;
}

const severityConfig = {
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  suggestion: { icon: Lightbulb, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  info: { icon: Info, color: 'text-studio-muted', bg: 'bg-white/5', border: 'border-white/5' },
};

const tiltLabel: Record<string, string> = { bright: 'Bright', neutral: 'Balanced', dark: 'Dark / Bass-Heavy' };
const densityLabel: Record<string, string> = {
  sparse: 'Very Dynamic',
  moderate: 'Moderate',
  dense: 'Compressed',
  crushed: 'Over-Compressed',
};

const stemIcon: Record<string, React.ElementType> = {
  vocals: Mic,
  drums: Drum,
  bass: Guitar,
  instruments: Music,
  fx: Sparkles,
};
const stemColor: Record<string, string> = {
  vocals: 'text-indigo-400',
  drums: 'text-orange-400',
  bass: 'text-green-400',
  instruments: 'text-yellow-400',
  fx: 'text-pink-400',
};

export default function AutoMasterReport({
  analysis,
  recommendations,
  trackName,
  separatedStemAnalysis,
  masteringStats,
  onDismiss,
}: AutoMasterReportProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="studio-panel overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-studio-accent" />
          <span className="text-xs font-semibold text-studio-text">Auto Master Report</span>
          <span className="text-[9px] text-studio-accent/80 bg-studio-accent/10 px-1.5 py-0.5 rounded font-mono truncate max-w-[90px]">
            {trackName}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onDismiss && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className="p-0.5 rounded hover:bg-white/10 text-studio-muted hover:text-studio-text transition-colors"
            >
              <X size={12} />
            </span>
          )}
          {expanded ? <ChevronUp size={13} className="text-studio-muted" /> : <ChevronDown size={13} className="text-studio-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Pipeline badge */}
          {masteringStats && (
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-purple-300/60">
              <Layers size={10} />
              Analyze → Corrective EQ → Bus Comp → LUFS Target → True-Peak Limit
            </div>
          )}

          {/* Mastering Output Stats */}
          {masteringStats && (
            <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-md p-2.5 space-y-2">
              <span className="text-[10px] font-semibold text-purple-300">Mastered Output</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-[9px]">
                  <span className="text-studio-muted">Final LUFS: </span>
                  <span className="font-mono text-studio-text">{masteringStats.finalLUFS > -Infinity ? masteringStats.finalLUFS.toFixed(1) : '—'}</span>
                </div>
                <div className="text-[9px]">
                  <span className="text-studio-muted">True Peak: </span>
                  <span className="font-mono text-studio-text">{masteringStats.truePeak > -Infinity ? `${masteringStats.truePeak.toFixed(1)} dBTP` : '—'}</span>
                </div>
                {masteringStats.detectedKey && (
                  <div className="text-[9px]">
                    <span className="text-studio-muted">Key: </span>
                    <span className="font-mono text-studio-text">{masteringStats.detectedKey}</span>
                  </div>
                )}
                {masteringStats.detectedBPM && (
                  <div className="text-[9px]">
                    <span className="text-studio-muted">BPM: </span>
                    <span className="font-mono text-studio-text">{masteringStats.detectedBPM}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {masteringStats.sonicCharacter && (
                  <span className="text-[8px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-medium capitalize">
                    {masteringStats.sonicCharacter}
                    {masteringStats.characterConfidence ? ` ${Math.round(masteringStats.characterConfidence * 100)}%` : ''}
                  </span>
                )}
                <span className="text-[8px] bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded font-medium">Clean Mastered</span>
                <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded font-medium">True-Peak Limited</span>
              </div>
            </div>
          )}

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-2">
            <MetricCard icon={Volume2} label="Peak" value={formatDb(analysis.peakDb)} color="text-studio-green" />
            <MetricCard icon={BarChart3} label="RMS" value={formatDb(analysis.rmsDb)} color="text-studio-cyan" />
            <MetricCard icon={Gauge} label="Est. LUFS" value={`${analysis.estimatedLUFS.toFixed(1)}`} color="text-purple-400" />
            <MetricCard icon={Activity} label="Dynamic Range" value={`${analysis.dynamicRange.toFixed(1)} dB`} color="text-studio-yellow" />
            <MetricCard icon={Radio} label="Stereo Corr." value={analysis.isMono ? 'Mono' : analysis.stereoCorrelation.toFixed(2)} color="text-pink-400" />
            <MetricCard
              icon={BarChart3}
              label="Density"
              value={densityLabel[analysis.densityCategory]}
              color={analysis.densityCategory === 'crushed' ? 'text-amber-400' : 'text-studio-text-dim'}
            />
          </div>

          {/* Spectral Tilt Bar */}
          <div className="bg-studio-bg/50 rounded-md p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-studio-muted font-medium">Spectral Tilt</span>
              <span className="text-[10px] font-mono text-studio-text-dim">{tiltLabel[analysis.spectralTilt]}</span>
            </div>
            <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-red-500/60 rounded-l-full transition-all"
                style={{ flex: analysis.freqBalance.low }}
              />
              <div
                className="bg-yellow-500/60 transition-all"
                style={{ flex: analysis.freqBalance.mid }}
              />
              <div
                className="bg-cyan-500/60 rounded-r-full transition-all"
                style={{ flex: analysis.freqBalance.high }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-studio-muted/60">
              <span>Low {(analysis.freqBalance.low * 100).toFixed(0)}%</span>
              <span>Mid {(analysis.freqBalance.mid * 100).toFixed(0)}%</span>
              <span>High {(analysis.freqBalance.high * 100).toFixed(0)}%</span>
            </div>
          </div>

          {/* Separated Stem Analysis */}
          {separatedStemAnalysis && separatedStemAnalysis.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] text-studio-muted font-medium uppercase tracking-wider">
                Separated Stems
              </span>
              <div className="space-y-1">
                {separatedStemAnalysis.map((sa) => {
                  const Icon = stemIcon[sa.type] || Music;
                  const color = stemColor[sa.type] || 'text-studio-muted';
                  return (
                    <div key={sa.stemId} className="flex items-center gap-2 bg-studio-bg/50 rounded-md px-2 py-1.5">
                      <Icon size={11} className={color} />
                      <span className={cn('text-[10px] font-semibold w-16 truncate', color)}>
                        {sa.type.charAt(0).toUpperCase() + sa.type.slice(1)}
                      </span>
                      <div className="flex gap-2.5 text-[9px] font-mono text-studio-muted">
                        <span>Pk {formatDb(sa.peakDb)}</span>
                        <span>RMS {formatDb(sa.rmsDb)}</span>
                        <span>CR {sa.crestFactor.toFixed(1)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-studio-muted font-medium uppercase tracking-wider">
              What was applied
            </span>
            {recommendations.map((rec, i) => {
              const cfg = severityConfig[rec.severity];
              const Icon = cfg.icon;
              return (
                <div key={i} className={cn('flex gap-2 items-start p-2 rounded-md border', cfg.bg, cfg.border)}>
                  <Icon size={12} className={cn('shrink-0 mt-0.5', cfg.color)} />
                  <div className="min-w-0">
                    <span className={cn('text-[10px] font-semibold', cfg.color)}>{rec.category}</span>
                    <p className="text-[10px] text-studio-muted leading-relaxed">{rec.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-studio-bg/50 rounded-md p-2 flex items-center gap-2">
      <Icon size={12} className={color} />
      <div className="min-w-0">
        <p className="text-[9px] text-studio-muted">{label}</p>
        <p className={cn('text-[11px] font-mono font-semibold truncate', color)}>{value}</p>
      </div>
    </div>
  );
}
