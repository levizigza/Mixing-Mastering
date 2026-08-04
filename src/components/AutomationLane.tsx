'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Pencil, Trash2, Plus, Minus } from 'lucide-react';
import { cn, clamp, mapRange } from '@/lib/utils';

export interface AutomationPoint {
  time: number; // seconds
  value: number; // 0-1 normalized
}

export interface AutomationLaneData {
  id: string;
  parameter: string; // e.g. 'gain', 'pan', 'compressor.threshold'
  label: string;
  color: string;
  points: AutomationPoint[];
  min: number; // parameter min
  max: number; // parameter max
  unit: string; // 'dB', '%', etc
}

interface AutomationLaneProps {
  lane: AutomationLaneData;
  duration: number;
  currentTime: number;
  height?: number;
  onChange: (points: AutomationPoint[]) => void;
  onRemove: () => void;
}

export default function AutomationLane({
  lane,
  duration,
  currentTime,
  height = 60,
  onChange,
  onRemove,
}: AutomationLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [hoverValue, setHoverValue] = useState<string | null>(null);

  const width = 800; // Will be responsive via CSS

  // Get value at a given time via linear interpolation
  const getValueAtTime = useCallback((time: number): number => {
    const pts = lane.points;
    if (pts.length === 0) return 0.5;
    if (pts.length === 1) return pts[0].value;
    if (time <= pts[0].time) return pts[0].value;
    if (time >= pts[pts.length - 1].time) return pts[pts.length - 1].value;

    for (let i = 1; i < pts.length; i++) {
      if (time <= pts[i].time) {
        const t = (time - pts[i - 1].time) / (pts[i].time - pts[i - 1].time);
        return pts[i - 1].value + t * (pts[i].value - pts[i - 1].value);
      }
    }
    return pts[pts.length - 1].value;
  }, [lane.points]);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw automation curve
    if (lane.points.length > 0 && duration > 0) {
      ctx.beginPath();
      ctx.strokeStyle = lane.color;
      ctx.lineWidth = 1.5;

      const steps = Math.min(w, 400);
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * duration;
        const val = getValueAtTime(t);
        const x = (t / duration) * w;
        const y = (1 - val) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Fill under curve
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = lane.color.replace(')', ', 0.08)').replace('rgb', 'rgba');
      ctx.fill();

      // Points
      lane.points.forEach((pt, idx) => {
        const x = (pt.time / duration) * w;
        const y = (1 - pt.value) * h;

        ctx.beginPath();
        ctx.arc(x, y, idx === draggingIdx ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = idx === draggingIdx ? '#fff' : lane.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }

    // Playhead
    if (duration > 0) {
      const px = (currentTime / duration) * w;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }, [lane, duration, currentTime, getValueAtTime, draggingIdx]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getCanvasCoords = (e: React.MouseEvent): { time: number; value: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { time: 0, value: 0.5 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const time = clamp((x / canvas.width) * duration, 0, duration);
    const value = clamp(1 - y / canvas.height, 0, 1);
    return { time, value };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const { time, value } = getCanvasCoords(e);
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check if clicking near existing point
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;

    for (let i = 0; i < lane.points.length; i++) {
      const pt = lane.points[i];
      const ptX = (pt.time / duration) * canvas.width;
      const ptY = (1 - pt.value) * canvas.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
      const dist = Math.sqrt((mouseX - ptX) ** 2 + (mouseY - ptY) ** 2);

      if (dist < 10) {
        if (e.button === 2 || e.ctrlKey) {
          // Right-click or ctrl-click: delete point
          const newPoints = [...lane.points];
          newPoints.splice(i, 1);
          onChange(newPoints);
          return;
        }
        setDraggingIdx(i);
        return;
      }
    }

    // Add new point
    const newPoints = [...lane.points, { time, value }];
    newPoints.sort((a, b) => a.time - b.time);
    onChange(newPoints);
    setDraggingIdx(newPoints.findIndex((p) => Math.abs(p.time - time) < 0.01));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { time, value } = getCanvasCoords(e);
    const realValue = lane.min + value * (lane.max - lane.min);
    setHoverValue(`${realValue.toFixed(1)}${lane.unit}`);

    if (draggingIdx !== null) {
      const newPoints = [...lane.points];
      newPoints[draggingIdx] = { time, value };
      newPoints.sort((a, b) => a.time - b.time);
      onChange(newPoints);
      // Update dragging index after sort
      const newIdx = newPoints.findIndex((p) => Math.abs(p.time - time) < 0.01);
      if (newIdx !== draggingIdx) setDraggingIdx(newIdx);
    }
  };

  const handleMouseUp = () => {
    setDraggingIdx(null);
  };

  return (
    <div className="space-y-0.5" ref={containerRef}>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: lane.color }} />
          <span className="text-[9px] font-mono text-studio-muted uppercase">{lane.label}</span>
          {hoverValue && (
            <span className="text-[8px] font-mono text-studio-text">{hoverValue}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-mono text-studio-muted">{lane.points.length} pts</span>
          <button onClick={onRemove} className="text-red-400/50 hover:text-red-400">
            <Trash2 size={9} />
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full rounded cursor-crosshair bg-studio-bg/50 border border-studio-border/30"
        style={{ height }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
