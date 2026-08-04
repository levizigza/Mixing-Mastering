'use client';

import React, { useState, useCallback } from 'react';
import { Plus, Sliders } from 'lucide-react';
import AutomationLane, { AutomationLaneData, AutomationPoint } from '@/components/AutomationLane';
import { cn } from '@/lib/utils';
import { generateId } from '@/lib/utils';

const AUTOMATABLE_PARAMS = [
  { parameter: 'gain', label: 'Volume', color: '#22c55e', min: -24, max: 12, unit: 'dB' },
  { parameter: 'pan', label: 'Pan', color: '#6366f1', min: -1, max: 1, unit: '' },
  { parameter: 'compressor.threshold', label: 'Comp Threshold', color: '#eab308', min: -60, max: 0, unit: 'dB' },
  { parameter: 'compressor.ratio', label: 'Comp Ratio', color: '#f97316', min: 1, max: 20, unit: ':1' },
  { parameter: 'saturation.drive', label: 'Sat Drive', color: '#ef4444', min: 0, max: 1, unit: '' },
  { parameter: 'eq.lowGain', label: 'EQ Low Gain', color: '#8b5cf6', min: -18, max: 18, unit: 'dB' },
  { parameter: 'eq.midGain', label: 'EQ Mid Gain', color: '#14b8a6', min: -18, max: 18, unit: 'dB' },
  { parameter: 'eq.highGain', label: 'EQ High Gain', color: '#ec4899', min: -18, max: 18, unit: 'dB' },
];

interface AutomationPanelProps {
  stemId: string | null;
  stemName: string;
  duration: number;
  currentTime: number;
  lanes: AutomationLaneData[];
  onLanesChange: (lanes: AutomationLaneData[]) => void;
}

export default function AutomationPanel({
  stemId,
  stemName,
  duration,
  currentTime,
  lanes,
  onLanesChange,
}: AutomationPanelProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);

  const addLane = useCallback((paramDef: typeof AUTOMATABLE_PARAMS[0]) => {
    // Don't add duplicate params
    if (lanes.find((l) => l.parameter === paramDef.parameter)) return;

    const newLane: AutomationLaneData = {
      id: generateId(),
      parameter: paramDef.parameter,
      label: paramDef.label,
      color: paramDef.color,
      points: [],
      min: paramDef.min,
      max: paramDef.max,
      unit: paramDef.unit,
    };
    onLanesChange([...lanes, newLane]);
    setShowAddMenu(false);
  }, [lanes, onLanesChange]);

  const updateLanePoints = useCallback((laneId: string, points: AutomationPoint[]) => {
    onLanesChange(lanes.map((l) => l.id === laneId ? { ...l, points } : l));
  }, [lanes, onLanesChange]);

  const removeLane = useCallback((laneId: string) => {
    onLanesChange(lanes.filter((l) => l.id !== laneId));
  }, [lanes, onLanesChange]);

  if (!stemId) return null;

  const availableParams = AUTOMATABLE_PARAMS.filter(
    (p) => !lanes.find((l) => l.parameter === p.parameter)
  );

  return (
    <div className="studio-panel p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-bold text-studio-text uppercase tracking-wider flex items-center gap-1.5">
          <Sliders size={11} className="text-studio-accent" />
          Automation — {stemName}
        </h3>
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            disabled={availableParams.length === 0}
            className="studio-button flex items-center gap-1 px-1.5 py-0.5 text-[9px] disabled:opacity-30"
          >
            <Plus size={9} />
            Add Lane
          </button>
          {showAddMenu && (
            <div className="absolute right-0 top-full mt-1 bg-studio-surface border border-studio-border rounded shadow-lg z-10 py-1 min-w-[140px]">
              {availableParams.map((p) => (
                <button
                  key={p.parameter}
                  onClick={() => addLane(p)}
                  className="w-full px-2 py-1 text-left text-[9px] font-mono text-studio-text hover:bg-white/5 flex items-center gap-1.5"
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {lanes.length === 0 ? (
        <div className="text-[9px] text-studio-muted text-center py-3">
          Click "Add Lane" to automate parameters over time
        </div>
      ) : (
        <div className="space-y-1">
          {lanes.map((lane) => (
            <AutomationLane
              key={lane.id}
              lane={lane}
              duration={duration}
              currentTime={currentTime}
              height={50}
              onChange={(points) => updateLanePoints(lane.id, points)}
              onRemove={() => removeLane(lane.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
