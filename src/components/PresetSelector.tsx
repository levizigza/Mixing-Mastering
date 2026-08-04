'use client';

import React, { useState } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Preset } from '@/types/audio';
import { presets, getPresetsByCategory } from '@/lib/presets';

interface PresetSelectorProps {
  activePresetId: string | null;
  onSelectPreset: (preset: Preset) => void;
}

const categories: { key: Preset['category']; label: string }[] = [
  { key: 'genre', label: 'Genre' },
  { key: 'mood', label: 'Mood' },
  { key: 'mastering', label: 'Mastering' },
];

export default function PresetSelector({
  activePresetId,
  onSelectPreset,
}: PresetSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Preset['category']>('genre');

  const filteredPresets = getPresetsByCategory(selectedCategory);
  const activePreset = presets.find((p) => p.id === activePresetId);

  return (
    <div className="studio-panel p-3 relative">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-studio-text flex items-center gap-1.5">
          <Sparkles size={14} className="text-studio-accent" />
          Presets
        </h3>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="studio-button flex items-center gap-1"
        >
          <span className="text-xs truncate max-w-[120px]">
            {activePreset ? activePreset.name : 'Select preset'}
          </span>
          <ChevronDown size={12} className={cn('transition-transform', isOpen && 'rotate-180')} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-studio-panel border border-studio-border rounded-lg shadow-2xl p-3 animate-fade-in">
          {/* Category tabs */}
          <div className="flex gap-1 mb-2">
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setSelectedCategory(cat.key)}
                className={cn(
                  'px-2 py-1 rounded text-[10px] font-mono font-medium transition-all',
                  selectedCategory === cat.key
                    ? 'bg-studio-accent text-white'
                    : 'text-studio-muted hover:text-studio-text'
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Preset list */}
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {filteredPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  onSelectPreset(preset);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-md transition-all',
                  activePresetId === preset.id
                    ? 'bg-studio-accent/20 border border-studio-accent/30'
                    : 'hover:bg-studio-surface border border-transparent'
                )}
              >
                <div className="text-xs font-medium text-studio-text">
                  {preset.name}
                </div>
                <div className="text-[10px] text-studio-muted mt-0.5">
                  {preset.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
