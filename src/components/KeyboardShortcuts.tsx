'use client';

import React from 'react';
import { X, Keyboard } from 'lucide-react';

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { category: 'Transport', items: [
    { keys: ['Space'], action: 'Play / Pause' },
    { keys: ['Ctrl', 'Space'], action: 'Stop & Rewind' },
  ]},
  { category: 'Editing', items: [
    { keys: ['Ctrl', 'Z'], action: 'Undo' },
    { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
    { keys: ['Ctrl', 'Y'], action: 'Redo (alt)' },
  ]},
  { category: 'Session', items: [
    { keys: ['Ctrl', 'S'], action: 'Save Session' },
    { keys: ['Ctrl', 'Shift', 'E'], action: 'Export' },
  ]},
  { category: 'Navigation', items: [
    { keys: ['1-9'], action: 'Select Stem 1-9' },
    { keys: ['M'], action: 'Select Master' },
    { keys: ['Tab'], action: 'Next Stem' },
    { keys: ['Shift', 'Tab'], action: 'Previous Stem' },
  ]},
  { category: 'Mixing', items: [
    { keys: ['B'], action: 'Toggle A/B Bypass' },
    { keys: ['L'], action: 'Toggle Loop' },
    { keys: ['Ctrl', 'M'], action: 'Mute Selected' },
    { keys: ['S'], action: 'Solo Selected' },
  ]},
];

export default function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-studio-surface border border-studio-border rounded-lg shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-studio-border">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-studio-accent" />
            <h2 className="text-sm font-bold text-studio-text">Keyboard Shortcuts</h2>
          </div>
          <button onClick={onClose} className="text-studio-muted hover:text-studio-text">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(80vh-60px)] p-4 space-y-4">
          {SHORTCUTS.map((category) => (
            <div key={category.category}>
              <h3 className="text-[10px] font-bold text-studio-accent uppercase tracking-wider mb-1.5">
                {category.category}
              </h3>
              <div className="space-y-1">
                {category.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1 px-2 rounded hover:bg-white/5">
                    <span className="text-[11px] text-studio-text">{item.action}</span>
                    <div className="flex items-center gap-0.5">
                      {item.keys.map((key, kidx) => (
                        <React.Fragment key={kidx}>
                          {kidx > 0 && <span className="text-[9px] text-studio-muted mx-0.5">+</span>}
                          <kbd className="px-1.5 py-0.5 bg-studio-bg border border-studio-border rounded text-[9px] font-mono text-studio-text min-w-[20px] text-center">
                            {key}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-studio-border text-center">
          <span className="text-[9px] text-studio-muted">
            Press <kbd className="px-1 py-0.5 bg-studio-bg border border-studio-border rounded text-[8px] font-mono">?</kbd> to toggle this panel
          </span>
        </div>
      </div>
    </div>
  );
}
