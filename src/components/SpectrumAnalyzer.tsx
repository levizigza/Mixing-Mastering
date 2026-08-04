'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { mapRange, clamp } from '@/lib/utils';

interface SpectrumAnalyzerProps {
  data: Float32Array | null;
  width?: number;
  height?: number;
  sampleRate?: number;
}

export default function SpectrumAnalyzer({
  data,
  width = 400,
  height = 120,
  sampleRate = 44100,
}: SpectrumAnalyzerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const smoothedData = useRef<Float32Array | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Background grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    [100, 1000, 10000].forEach((freq) => {
      const x =
        (Math.log10(freq / 20) / Math.log10(20000 / 20)) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });

    if (!data || data.length === 0) return;

    // Smooth data
    if (!smoothedData.current || smoothedData.current.length !== data.length) {
      smoothedData.current = new Float32Array(data.length);
    }
    for (let i = 0; i < data.length; i++) {
      smoothedData.current[i] =
        smoothedData.current[i] * 0.7 + data[i] * 0.3;
    }

    const binCount = data.length;
    const freqPerBin = sampleRate / (binCount * 2);

    // Draw spectrum bars
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#22c55e');
    gradient.addColorStop(0.6, '#eab308');
    gradient.addColorStop(0.85, '#f97316');
    gradient.addColorStop(1, '#ef4444');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, height);

    const numBars = 128;
    for (let i = 0; i < numBars; i++) {
      const logFreq = 20 * Math.pow(20000 / 20, i / numBars);
      const bin = Math.round(logFreq / freqPerBin);
      if (bin >= binCount) break;

      const value = smoothedData.current[clamp(bin, 0, binCount - 1)];
      const normalizedValue = clamp(mapRange(value, -100, 0, 0, 1), 0, 1);
      const barHeight = normalizedValue * height;
      const x = (i / numBars) * width;

      ctx.lineTo(x, height - barHeight);
    }

    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Draw line on top
    ctx.beginPath();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;

    for (let i = 0; i < numBars; i++) {
      const logFreq = 20 * Math.pow(20000 / 20, i / numBars);
      const bin = Math.round(logFreq / freqPerBin);
      if (bin >= binCount) break;

      const value = smoothedData.current[clamp(bin, 0, binCount - 1)];
      const normalizedValue = clamp(mapRange(value, -100, 0, 0, 1), 0, 1);
      const barHeight = normalizedValue * height;
      const x = (i / numBars) * width;

      if (i === 0) ctx.moveTo(x, height - barHeight);
      else ctx.lineTo(x, height - barHeight);
    }
    ctx.stroke();

    // Freq labels
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '8px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ['100', '1k', '10k'].forEach((label, idx) => {
      const freqs = [100, 1000, 10000];
      const x =
        (Math.log10(freqs[idx] / 20) / Math.log10(20000 / 20)) * width;
      ctx.fillText(label, x, height - 4);
    });
  }, [data, width, height, sampleRate]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div className="studio-panel p-3">
      <span className="studio-label mb-2 block">Spectrum Analyzer</span>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full rounded bg-studio-bg"
        style={{ height }}
      />
    </div>
  );
}
