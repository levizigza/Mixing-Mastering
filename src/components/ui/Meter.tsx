'use client';

import React, { useMemo } from 'react';
import { cn, clamp, mapRange } from '@/lib/utils';

interface MeterProps {
  value: number;
  peak?: number;
  min?: number;
  max?: number;
  orientation?: 'horizontal' | 'vertical';
  height?: number;
  width?: number;
  showScale?: boolean;
  label?: string;
  className?: string;
}

export default function Meter({
  value,
  peak,
  min = -60,
  max = 6,
  orientation = 'vertical',
  height = 160,
  width = 8,
  showScale = false,
  label,
  className,
}: MeterProps) {
  const normalized = clamp(mapRange(value, min, max, 0, 1), 0, 1);
  const peakNormalized = peak !== undefined
    ? clamp(mapRange(peak, min, max, 0, 1), 0, 1)
    : undefined;

  const getColor = (val: number) => {
    if (val > 0) return '#ef4444';
    if (val > -6) return '#eab308';
    if (val > -12) return '#22c55e';
    return '#22c55e';
  };

  const segments = useMemo(() => {
    const count = Math.floor(height / 3);
    return Array.from({ length: count }, (_, i) => {
      const segNorm = i / count;
      const segDb = mapRange(segNorm, 0, 1, min, max);
      const isActive = segNorm <= normalized;
      return { segNorm, segDb, isActive };
    });
  }, [height, min, max, normalized]);

  const scaleMarks = [-48, -36, -24, -18, -12, -6, -3, 0, 3, 6];

  if (orientation === 'vertical') {
    return (
      <div className={cn('flex items-end gap-0.5', className)}>
        {showScale && (
          <div className="relative flex flex-col justify-between" style={{ height }}>
            {scaleMarks.filter(m => m >= min && m <= max).map((mark) => {
              const pos = mapRange(mark, min, max, 100, 0);
              return (
                <span
                  key={mark}
                  className="absolute right-0 text-[8px] font-mono text-studio-muted leading-none"
                  style={{ top: `${pos}%`, transform: 'translateY(-50%)' }}
                >
                  {mark}
                </span>
              );
            })}
          </div>
        )}
        <div className="flex flex-col-reverse gap-px" style={{ height, width }}>
          {segments.map((seg, i) => (
            <div
              key={i}
              className="rounded-[1px] transition-opacity duration-75"
              style={{
                height: 2,
                backgroundColor: seg.isActive ? getColor(seg.segDb) : 'rgba(255,255,255,0.04)',
                opacity: seg.isActive ? 1 : 0.3,
              }}
            />
          ))}
        </div>
        {peakNormalized !== undefined && (
          <div className="relative" style={{ height, width: 2 }}>
            <div
              className="absolute left-0 right-0 h-[2px] transition-all duration-150"
              style={{
                bottom: `${peakNormalized * 100}%`,
                backgroundColor: getColor(peak ?? min),
              }}
            />
          </div>
        )}
        {label && (
          <span className="studio-label text-center w-full mt-1 block">{label}</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {label && <span className="studio-label">{label}</span>}
      <div className="flex gap-px" style={{ height: width, width: '100%' }}>
        {segments.map((seg, i) => (
          <div
            key={i}
            className="rounded-[1px] flex-1 transition-opacity duration-75"
            style={{
              backgroundColor: seg.isActive ? getColor(seg.segDb) : 'rgba(255,255,255,0.04)',
              opacity: seg.isActive ? 1 : 0.3,
            }}
          />
        ))}
      </div>
    </div>
  );
}
