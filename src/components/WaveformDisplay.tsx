'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { Stem } from '@/types/audio';
import { mapRange, clamp } from '@/lib/utils';

interface WaveformDisplayProps {
  stems: Stem[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  width?: number;
  height?: number;
}

const stemColors: Record<string, string> = {
  vocals: '#6366f1',
  drums: '#f97316',
  bass: '#22c55e',
  instruments: '#eab308',
  fx: '#06b6d4',
};

export default function WaveformDisplay({
  stems,
  currentTime,
  duration,
  onSeek,
  width = 800,
  height = 100,
}: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0, 0, width, height);

    // Grid lines (time)
    if (duration > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      const interval = duration > 60 ? 10 : duration > 30 ? 5 : 1;
      for (let t = 0; t <= duration; t += interval) {
        const x = (t / duration) * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Draw waveforms
    const stemCount = stems.filter((s) => s.waveformData).length;
    if (stemCount === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No audio loaded', width / 2, height / 2);
      return;
    }

    const laneHeight = height / stemCount;
    let laneIndex = 0;

    stems.forEach((stem) => {
      if (!stem.waveformData) return;
      const color = stemColors[stem.type] || '#6366f1';
      const yOffset = laneIndex * laneHeight;
      const centerY = yOffset + laneHeight / 2;

      ctx.fillStyle = `${color}20`;
      ctx.fillRect(0, yOffset, width, laneHeight);

      // Label
      ctx.fillStyle = `${color}60`;
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(stem.type.toUpperCase(), 4, yOffset + 10);

      // Waveform
      const data = stem.waveformData;
      const step = Math.max(1, Math.floor(data.length / width));

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;

      for (let x = 0; x < width; x++) {
        const dataIndex = Math.floor((x / width) * data.length);
        const amplitude = data[clamp(dataIndex, 0, data.length - 1)];
        const barHeight = amplitude * (laneHeight / 2) * 0.9;

        ctx.moveTo(x, centerY - barHeight);
        ctx.lineTo(x, centerY + barHeight);
      }
      ctx.stroke();

      // Mute indicator
      if (stem.processing.mute) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.fillRect(0, yOffset, width, laneHeight);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('MUTED', width / 2, centerY + 4);
      }

      laneIndex++;
    });

    // Playhead
    if (duration > 0) {
      const playheadX = (currentTime / duration) * width;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Playhead glow
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }
  }, [stems, currentTime, duration, width, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (duration <= 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      onSeek(clamp(ratio * duration, 0, duration));
    },
    [duration, onSeek]
  );

  return (
    <div className="studio-panel p-3">
      <span className="studio-label mb-2 block">Waveform</span>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full rounded bg-studio-bg cursor-pointer"
        style={{ height }}
        onClick={handleClick}
      />
    </div>
  );
}
