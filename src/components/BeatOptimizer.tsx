'use client';

import React, { useState, useCallback } from 'react';
import {
  Drum,
  Zap,
  ChevronDown,
  ChevronUp,
  Play,
  RotateCcw,
  Loader2,
  Activity,
  Timer,
  Target,
  Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Knob from '@/components/ui/Knob';
import Slider from '@/components/ui/Slider';
import {
  BeatOptimizeSettings,
  BeatAnalysis,
  defaultBeatSettings,
  beatPresets,
} from '@/lib/beat-optimizer';

interface BeatOptimizerProps {
  stemId: string | null;
  stemName?: string;
  stemType?: string;
  analysis: BeatAnalysis | null;
  isOptimizing: boolean;
  optimizeProgress: number;
  optimizeMessage: string;
  onOptimize: (stemId: string, settings: BeatOptimizeSettings) => void;
}

export default function BeatOptimizer({
  stemId,
  stemName,
  stemType,
  analysis,
  isOptimizing,
  optimizeProgress,
  optimizeMessage,
  onOptimize,
}: BeatOptimizerProps) {
  const [expanded, setExpanded] = useState(true);
  const [settings, setSettings] = useState<BeatOptimizeSettings>({ ...defaultBeatSettings });
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const updateSetting = useCallback(<K extends keyof BeatOptimizeSettings>(key: K, value: BeatOptimizeSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setActivePreset(null);
  }, []);

  const applyPreset = useCallback((preset: typeof beatPresets[number]) => {
    setSettings({ ...preset.settings });
    setActivePreset(preset.name);
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...defaultBeatSettings });
    setActivePreset(null);
  }, []);

  const handleOptimize = useCallback(() => {
    if (!stemId) return;
    onOptimize(stemId, settings);
  }, [stemId, settings, onOptimize]);

  if (!stemId) {
    return (
      <div className="studio-panel p-4">
        <h3 className="text-sm font-semibold text-studio-text flex items-center gap-2">
          <Drum size={14} className="text-orange-400" />
          Beat Optimizer
        </h3>
        <p className="text-xs text-studio-muted mt-2">
          Select a stem to optimize its beat.
        </p>
      </div>
    );
  }

  return (
    <div className="studio-panel overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Drum size={14} className="text-orange-400" />
          <span className="text-xs font-semibold text-studio-text">Beat Optimizer</span>
          {stemName && (
            <span className="text-[9px] text-orange-300/70 bg-orange-500/10 px-1.5 py-0.5 rounded font-mono truncate max-w-[80px]">
              {stemName}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={13} className="text-studio-muted" /> : <ChevronDown size={13} className="text-studio-muted" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">

          {/* Analysis Results */}
          {analysis && (
            <div className="grid grid-cols-3 gap-1.5">
              <AnalysisBadge icon={Timer} label="BPM" value={`${analysis.bpm}`} color="text-orange-400" />
              <AnalysisBadge icon={Target} label="Hits" value={`${analysis.totalHits}`} color="text-cyan-400" />
              <AnalysisBadge icon={Gauge} label="Groove" value={`${(analysis.grooveTightness * 100).toFixed(0)}%`} color="text-green-400" />
              <AnalysisBadge icon={Activity} label="Kicks" value={`${analysis.kickCount}`} color="text-red-400" />
              <AnalysisBadge icon={Activity} label="Snares" value={`${analysis.snareCount}`} color="text-yellow-400" />
              <AnalysisBadge icon={Activity} label="Hats" value={`${analysis.hatCount}`} color="text-blue-400" />
            </div>
          )}

          {/* Presets */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-studio-muted font-medium uppercase tracking-wider">Presets</span>
            <div className="flex flex-wrap gap-1">
              {beatPresets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  title={preset.description}
                  className={cn(
                    'px-2 py-1 rounded text-[10px] font-medium transition-all',
                    activePreset === preset.name
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                      : 'text-studio-muted hover:text-studio-text bg-studio-bg/50 hover:bg-white/5 border border-transparent'
                  )}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Kick Controls */}
          <ControlGroup label="Kick" color="#ef4444">
            <Slider
              value={settings.kickPunch}
              min={0}
              max={100}
              step={1}
              label="Punch"
              unit="%"
              orientation="horizontal"
              color="#ef4444"
              onChange={(v) => updateSetting('kickPunch', v)}
              defaultValue={50}
            />
            <Slider
              value={settings.kickSub}
              min={0}
              max={100}
              step={1}
              label="Sub"
              unit="%"
              orientation="horizontal"
              color="#ef4444"
              onChange={(v) => updateSetting('kickSub', v)}
              defaultValue={40}
            />
          </ControlGroup>

          {/* Snare Controls */}
          <ControlGroup label="Snare" color="#eab308">
            <Slider
              value={settings.snareCrack}
              min={0}
              max={100}
              step={1}
              label="Crack"
              unit="%"
              orientation="horizontal"
              color="#eab308"
              onChange={(v) => updateSetting('snareCrack', v)}
              defaultValue={50}
            />
            <Slider
              value={settings.snareBody}
              min={0}
              max={100}
              step={1}
              label="Body"
              unit="%"
              orientation="horizontal"
              color="#eab308"
              onChange={(v) => updateSetting('snareBody', v)}
              defaultValue={40}
            />
          </ControlGroup>

          {/* Hi-Hat Controls */}
          <ControlGroup label="Hi-Hat" color="#3b82f6">
            <Slider
              value={settings.hatCrisp}
              min={0}
              max={100}
              step={1}
              label="Crisp"
              unit="%"
              orientation="horizontal"
              color="#3b82f6"
              onChange={(v) => updateSetting('hatCrisp', v)}
              defaultValue={45}
            />
            <Slider
              value={settings.hatSoft}
              min={0}
              max={100}
              step={1}
              label="Soft"
              unit="%"
              orientation="horizontal"
              color="#3b82f6"
              onChange={(v) => updateSetting('hatSoft', v)}
              defaultValue={20}
            />
          </ControlGroup>

          {/* Global Controls */}
          <ControlGroup label="Global" color="#a855f7">
            <Slider
              value={settings.overallPunch}
              min={0}
              max={100}
              step={1}
              label="Punch"
              unit="%"
              orientation="horizontal"
              color="#a855f7"
              onChange={(v) => updateSetting('overallPunch', v)}
              defaultValue={50}
            />
            <Slider
              value={settings.transientAttack}
              min={0}
              max={100}
              step={1}
              label="Attack"
              unit="%"
              orientation="horizontal"
              color="#a855f7"
              onChange={(v) => updateSetting('transientAttack', v)}
              defaultValue={50}
            />
            <Slider
              value={settings.groove}
              min={0}
              max={100}
              step={1}
              label="Groove Tighten"
              unit="%"
              orientation="horizontal"
              color="#22c55e"
              onChange={(v) => updateSetting('groove', v)}
              defaultValue={0}
            />
          </ControlGroup>

          {/* Progress Bar */}
          {isOptimizing && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="text-orange-400 animate-spin" />
                <span className="text-[10px] text-orange-300">{optimizeMessage}</span>
              </div>
              <div className="h-1.5 bg-studio-bg rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-yellow-500 rounded-full transition-all duration-200"
                  style={{ width: `${optimizeProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleOptimize}
              disabled={isOptimizing || !stemId}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all',
                isOptimizing
                  ? 'bg-orange-500/10 text-orange-300/50 cursor-not-allowed'
                  : 'bg-gradient-to-r from-orange-500/20 to-yellow-500/20 text-orange-300 hover:from-orange-500/30 hover:to-yellow-500/30 border border-orange-500/30'
              )}
            >
              {isOptimizing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Zap size={13} />
              )}
              {isOptimizing ? 'Optimizing...' : 'Optimize Beat'}
            </button>
            <button
              onClick={resetSettings}
              className="px-2.5 py-2 rounded-md text-xs text-studio-muted hover:text-studio-text bg-studio-bg/50 hover:bg-white/5 transition-colors"
              title="Reset to defaults"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlGroup({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color }}>
        {label}
      </span>
      <div className="space-y-2 pl-1">
        {children}
      </div>
    </div>
  );
}

function AnalysisBadge({
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
    <div className="bg-studio-bg/50 rounded-md px-2 py-1.5 flex items-center gap-1.5">
      <Icon size={10} className={color} />
      <div className="min-w-0">
        <p className="text-[8px] text-studio-muted leading-none">{label}</p>
        <p className={cn('text-[10px] font-mono font-semibold', color)}>{value}</p>
      </div>
    </div>
  );
}
