'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface ToggleProps {
  active: boolean;
  label: string;
  activeColor?: string;
  size?: 'sm' | 'md';
  onChange: (active: boolean) => void;
  className?: string;
}

export default function Toggle({
  active,
  label,
  activeColor = '#6366f1',
  size = 'sm',
  onChange,
  className,
}: ToggleProps) {
  return (
    <button
      className={cn(
        'rounded font-mono font-medium transition-all duration-150 border',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs',
        active
          ? 'border-transparent text-white'
          : 'border-studio-border text-studio-muted hover:text-studio-text hover:border-studio-muted bg-transparent',
        className
      )}
      style={
        active
          ? { backgroundColor: activeColor, boxShadow: `0 0 8px ${activeColor}40` }
          : undefined
      }
      onClick={() => onChange(!active)}
    >
      {label}
    </button>
  );
}
