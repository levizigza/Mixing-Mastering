'use client';

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { EQBand } from '@/types/audio';
import { clamp, mapRange } from '@/lib/utils';

interface ParametricEQProps {
  bands: EQBand[];
  onChange: (bands: EQBand[]) => void;
  width?: number;
  height?: number;
  color?: string;
}

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_GAIN = -18;
const MAX_GAIN = 18;

function freqToX(freq: number, width: number): number {
  return (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width;
}

function xToFreq(x: number, width: number): number {
  const ratio = x / width;
  return MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, ratio);
}

function gainToY(gain: number, height: number): number {
  return mapRange(gain, MAX_GAIN, MIN_GAIN, 0, height);
}

function yToGain(y: number, height: number): number {
  return mapRange(y, 0, height, MAX_GAIN, MIN_GAIN);
}

export default function ParametricEQ({
  bands,
  onChange,
  width = 400,
  height = 160,
  color = '#6366f1',
}: ParametricEQProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draggingBand, setDraggingBand] = useState<number | null>(null);

  const drawEQ = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;

    // Frequency grid lines
    [100, 1000, 10000].forEach((freq) => {
      const x = freqToX(freq, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });

    // Gain grid lines
    [-12, -6, 0, 6, 12].forEach((gain) => {
      const y = gainToY(gain, height);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    });

    // Zero line
    const zeroY = gainToY(0, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(width, zeroY);
    ctx.stroke();

    // Frequency labels
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    [20, 50, 100, 200, 500, '1k', '2k', '5k', '10k', '20k'].forEach((label, i) => {
      const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      const x = freqToX(freqs[i], width);
      ctx.fillText(String(label), x, height - 4);
    });

    // EQ curve
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    for (let px = 0; px < width; px++) {
      const freq = xToFreq(px, width);
      let totalGain = 0;

      bands.forEach((band) => {
        const distance = Math.log2(freq / band.frequency);
        const bandwidth = 1 / (band.Q || 1);
        const response = band.gain * Math.exp((-distance * distance) / (2 * bandwidth * bandwidth));
        totalGain += response;
      });

      const y = gainToY(clamp(totalGain, MIN_GAIN, MAX_GAIN), height);
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(width, zeroY);
    ctx.lineTo(0, zeroY);
    ctx.closePath();
    ctx.fillStyle = `${color}15`;
    ctx.fill();

    // Band handles
    bands.forEach((band, i) => {
      const x = freqToX(band.frequency, width);
      const y = gainToY(band.gain, height);

      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = i === draggingBand ? color : `${color}80`;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = 'white';
      ctx.font = 'bold 8px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y);
    });
  }, [bands, width, height, color, draggingBand]);

  useEffect(() => {
    drawEQ();
  }, [drawEQ]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let closest = -1;
      let closestDist = Infinity;
      bands.forEach((band, i) => {
        const bx = freqToX(band.frequency, width);
        const by = gainToY(band.gain, height);
        const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
        if (dist < closestDist && dist < 20) {
          closestDist = dist;
          closest = i;
        }
      });

      if (closest >= 0) {
        setDraggingBand(closest);

        const handleMouseMove = (e: MouseEvent) => {
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const freq = clamp(xToFreq(mx, width), MIN_FREQ, MAX_FREQ);
          const gain = clamp(yToGain(my, height), MIN_GAIN, MAX_GAIN);

          const newBands = [...bands];
          newBands[closest] = {
            ...newBands[closest],
            frequency: Math.round(freq),
            gain: Math.round(gain * 2) / 2,
          };
          onChange(newBands);
        };

        const handleMouseUp = () => {
          setDraggingBand(null);
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      }
    },
    [bands, width, height, onChange]
  );

  return (
    <div className="studio-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="studio-label">Parametric EQ</span>
        <div className="flex gap-2">
          {bands.map((band, i) => (
            <span key={i} className="text-[9px] font-mono text-studio-muted">
              {band.frequency < 1000
                ? `${band.frequency}Hz`
                : `${(band.frequency / 1000).toFixed(1)}kHz`}
              {' '}
              <span style={{ color: band.gain >= 0 ? '#22c55e' : '#ef4444' }}>
                {band.gain >= 0 ? '+' : ''}{band.gain.toFixed(1)}dB
              </span>
            </span>
          ))}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full rounded bg-studio-bg cursor-crosshair"
        style={{ height }}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
