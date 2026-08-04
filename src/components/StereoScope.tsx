'use client';

import React, { useRef, useEffect, useCallback } from 'react';

interface StereoScopeProps {
  dataL: Float32Array | null;
  dataR: Float32Array | null;
  width?: number;
  height?: number;
}

export default function StereoScope({
  dataL,
  dataR,
  width = 160,
  height = 160,
}: StereoScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fade previous frame
    ctx.fillStyle = 'rgba(10, 10, 15, 0.15)';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;

    // Cross hairs
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.moveTo(0, cy);
    ctx.lineTo(width, cy);
    // Diagonal (M/S axes)
    ctx.moveTo(0, 0);
    ctx.lineTo(width, height);
    ctx.moveTo(width, 0);
    ctx.lineTo(0, height);
    ctx.stroke();

    // Labels
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '8px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('M', cx, 10);
    ctx.fillText('S', cx, height - 4);
    ctx.fillText('L', 8, cy + 3);
    ctx.fillText('R', width - 8, cy + 3);

    if (!dataL || !dataR || dataL.length === 0) return;

    const scale = Math.min(width, height) * 0.35;

    ctx.beginPath();
    const len = Math.min(dataL.length, dataR.length, 512);

    for (let i = 0; i < len; i++) {
      const l = dataL[i];
      const r = dataR[i];

      // Lissajous: rotate 45 degrees for M/S display
      const x = cx + (l - r) * scale;
      const y = cy - (l + r) * scale * 0.5;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Color based on correlation (green = correlated, red = out of phase)
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.7)');
    gradient.addColorStop(0.5, 'rgba(34, 197, 94, 0.7)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.7)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw dots at sample positions for detail
    ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
    for (let i = 0; i < len; i += 4) {
      const l = dataL[i];
      const r = dataR[i];
      const x = cx + (l - r) * scale;
      const y = cy - (l + r) * scale * 0.5;
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }, [dataL, dataR, width, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div className="studio-panel p-2">
      <span className="studio-label mb-1 block">Stereo Scope</span>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded bg-studio-bg"
        style={{ width, height }}
      />
    </div>
  );
}
