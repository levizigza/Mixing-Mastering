'use client';

import React, { useCallback, useRef, useState } from 'react';
import { cn, clamp } from '@/lib/utils';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  unit?: string;
  orientation?: 'horizontal' | 'vertical';
  color?: string;
  height?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  defaultValue?: number;
}

export default function Slider({
  value,
  min,
  max,
  step = 0.1,
  label,
  unit = '',
  orientation = 'vertical',
  color = '#6366f1',
  height = 120,
  onChange,
  formatValue,
  defaultValue,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const normalized = clamp((value - min) / (max - min), 0, 1);

  const handleInteraction = useCallback(
    (clientX: number, clientY: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();

      let ratio: number;
      if (orientation === 'vertical') {
        ratio = 1 - (clientY - rect.top) / rect.height;
      } else {
        ratio = (clientX - rect.left) / rect.width;
      }
      ratio = clamp(ratio, 0, 1);
      const raw = min + ratio * (max - min);
      const stepped = Math.round(raw / step) * step;
      onChange(Number(clamp(stepped, min, max).toFixed(6)));
    },
    [min, max, step, orientation, onChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      handleInteraction(e.clientX, e.clientY);

      const handleMouseMove = (e: MouseEvent) => {
        handleInteraction(e.clientX, e.clientY);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [handleInteraction]
  );

  const handleDoubleClick = useCallback(() => {
    if (defaultValue !== undefined) {
      onChange(defaultValue);
    }
  }, [defaultValue, onChange]);

  const displayValue = formatValue
    ? formatValue(value)
    : `${value.toFixed(1)}${unit}`;

  if (orientation === 'vertical') {
    return (
      <div className="flex flex-col items-center gap-1 select-none">
        {label && <span className="studio-label">{label}</span>}
        <div
          ref={trackRef}
          className={cn(
            'relative w-2 rounded-full bg-white/5 cursor-pointer',
            isDragging && 'bg-white/10'
          )}
          style={{ height }}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          <div
            className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-75"
            style={{
              height: `${normalized * 100}%`,
              backgroundColor: color,
              boxShadow: isDragging ? `0 0 8px ${color}` : 'none',
            }}
          />
          <div
            className="absolute left-1/2 -translate-x-1/2 w-4 h-2 rounded-sm bg-studio-text shadow-md transition-all duration-75"
            style={{
              bottom: `calc(${normalized * 100}% - 4px)`,
              boxShadow: isDragging
                ? `0 0 6px ${color}, 0 2px 4px rgba(0,0,0,0.5)`
                : '0 2px 4px rgba(0,0,0,0.5)',
            }}
          />
        </div>
        <span className="studio-value">{displayValue}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 select-none w-full">
      <div className="flex justify-between items-center">
        {label && <span className="studio-label">{label}</span>}
        <span className="studio-value">{displayValue}</span>
      </div>
      <div
        ref={trackRef}
        className={cn(
          'relative h-2 rounded-full bg-white/5 cursor-pointer',
          isDragging && 'bg-white/10'
        )}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="absolute top-0 left-0 h-full rounded-full transition-all duration-75"
          style={{
            width: `${normalized * 100}%`,
            backgroundColor: color,
          }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md border-2 transition-all duration-75"
          style={{
            left: `calc(${normalized * 100}% - 6px)`,
            borderColor: color,
          }}
        />
      </div>
    </div>
  );
}
