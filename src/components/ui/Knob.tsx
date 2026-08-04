'use client';

import React, { useCallback, useRef, useState } from 'react';
import { cn, mapRange, clamp } from '@/lib/utils';

interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  unit?: string;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  defaultValue?: number;
}

const SIZES = { sm: 36, md: 48, lg: 64 };
const STROKE = { sm: 3, md: 4, lg: 5 };
const ARC_START = 135;
const ARC_END = 405;

export default function Knob({
  value,
  min,
  max,
  step = 0.1,
  label,
  unit = '',
  size = 'md',
  color = '#6366f1',
  onChange,
  formatValue,
  defaultValue,
}: KnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartValue = useRef(0);

  const sz = SIZES[size];
  const strokeW = STROKE[size];
  const radius = (sz - strokeW) / 2;
  const center = sz / 2;
  const circumference = 2 * Math.PI * radius;

  const normalizedValue = clamp((value - min) / (max - min), 0, 1);
  const angle = mapRange(normalizedValue, 0, 1, ARC_START, ARC_END);
  const arcLength = mapRange(normalizedValue, 0, 1, 0, circumference * 0.75);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartY.current = e.clientY;
      dragStartValue.current = value;

      const handleMouseMove = (e: MouseEvent) => {
        const delta = dragStartY.current - e.clientY;
        const sensitivity = e.shiftKey ? 0.1 : 0.5;
        const range = max - min;
        const newValue = clamp(
          dragStartValue.current + (delta * range * sensitivity) / 150,
          min,
          max
        );
        const stepped = Math.round(newValue / step) * step;
        onChange(Number(stepped.toFixed(6)));
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [value, min, max, step, onChange]
  );

  const handleDoubleClick = useCallback(() => {
    if (defaultValue !== undefined) {
      onChange(defaultValue);
    }
  }, [defaultValue, onChange]);

  const displayValue = formatValue
    ? formatValue(value)
    : `${value.toFixed(1)}${unit}`;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        ref={knobRef}
        className={cn(
          'relative cursor-grab active:cursor-grabbing transition-transform',
          isDragging && 'scale-105'
        )}
        style={{ width: sz, height: sz }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <svg width={sz} height={sz} className="transform -rotate-[135deg]">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={strokeW}
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            strokeLinecap="round"
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeW}
            strokeDasharray={`${arcLength} ${circumference - arcLength}`}
            strokeLinecap="round"
            className="transition-all duration-75"
            style={{
              filter: isDragging ? `drop-shadow(0 0 4px ${color})` : 'none',
            }}
          />
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div
            className="w-1 h-1 rounded-full"
            style={{
              backgroundColor: color,
              transform: `translateY(-${radius - 2}px)`,
              boxShadow: `0 0 4px ${color}`,
            }}
          />
        </div>
      </div>
      <span className="studio-value text-center leading-tight" style={{ fontSize: size === 'sm' ? '9px' : '10px' }}>
        {displayValue}
      </span>
      <span className="studio-label text-center leading-tight">{label}</span>
    </div>
  );
}
