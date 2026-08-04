'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Flag, Plus, Trash2, X } from 'lucide-react';
import { cn, formatTime, clamp, mapRange, generateId } from '@/lib/utils';
import type { Marker, Region } from '@/types/audio';

export type { Marker, Region };

interface MarkerTimelineProps {
  duration: number;
  currentTime: number;
  markers: Marker[];
  regions: Region[];
  onAddMarker: (marker: Marker) => void;
  onRemoveMarker: (id: string) => void;
  onAddRegion: (region: Region) => void;
  onRemoveRegion: (id: string) => void;
  onSeek: (time: number) => void;
}

const MARKER_COLORS = ['#6366f1', '#22c55e', '#eab308', '#ef4444', '#06b6d4', '#f97316', '#ec4899'];

export default function MarkerTimeline({
  duration,
  currentTime,
  markers,
  regions,
  onAddMarker,
  onRemoveMarker,
  onAddRegion,
  onRemoveRegion,
  onSeek,
}: MarkerTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAddingRegion, setIsAddingRegion] = useState(false);
  const [regionStart, setRegionStart] = useState<number | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<string | null>(null);

  const timeToPercent = (time: number) => {
    if (duration <= 0) return 0;
    return clamp((time / duration) * 100, 0, 100);
  };

  const getTimeFromClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return 0;
      const x = e.clientX - rect.left;
      return clamp((x / rect.width) * duration, 0, duration);
    },
    [duration]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const time = getTimeFromClick(e);
      if (isAddingRegion) {
        if (regionStart === null) {
          setRegionStart(time);
        } else {
          const start = Math.min(regionStart, time);
          const end = Math.max(regionStart, time);
          if (end - start > 0.1) {
            onAddRegion({
              id: generateId(),
              start,
              end,
              label: `Region ${regions.length + 1}`,
              color: MARKER_COLORS[(regions.length) % MARKER_COLORS.length],
            });
          }
          setRegionStart(null);
          setIsAddingRegion(false);
        }
      }
    },
    [getTimeFromClick, isAddingRegion, regionStart, onAddRegion, regions.length]
  );

  const handleAddMarker = () => {
    onAddMarker({
      id: generateId(),
      time: currentTime,
      label: `M${markers.length + 1}`,
      color: MARKER_COLORS[markers.length % MARKER_COLORS.length],
    });
  };

  return (
    <div className="studio-panel px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-[9px] font-bold text-studio-text uppercase tracking-wider flex items-center gap-1">
          <Flag size={10} className="text-studio-accent" />
          Markers & Regions
        </h4>
        <div className="flex gap-1">
          <button
            onClick={handleAddMarker}
            className="studio-button px-1.5 py-0.5 text-[8px] flex items-center gap-0.5"
            title="Add marker at playhead"
          >
            <Plus size={9} />
            Marker
          </button>
          <button
            onClick={() => {
              setIsAddingRegion(!isAddingRegion);
              setRegionStart(null);
            }}
            className={cn(
              'studio-button px-1.5 py-0.5 text-[8px] flex items-center gap-0.5',
              isAddingRegion && 'bg-studio-accent/20 text-studio-accent border-studio-accent/40'
            )}
            title="Click two points to create a region"
          >
            <Plus size={9} />
            Region
          </button>
        </div>
      </div>

      {isAddingRegion && (
        <div className="text-[8px] text-studio-accent font-mono animate-fade-in">
          {regionStart === null
            ? 'Click on timeline to set region start...'
            : `Start: ${formatTime(regionStart)} — click to set end`}
        </div>
      )}

      {/* Timeline bar */}
      <div
        ref={containerRef}
        onClick={handleClick}
        className={cn(
          'relative h-6 bg-studio-surface rounded cursor-crosshair overflow-hidden',
          isAddingRegion && 'ring-1 ring-studio-accent/40'
        )}
      >
        {/* Regions */}
        {regions.map((region) => (
          <div
            key={region.id}
            className="absolute top-0 bottom-0 group"
            style={{
              left: `${timeToPercent(region.start)}%`,
              width: `${timeToPercent(region.end) - timeToPercent(region.start)}%`,
              backgroundColor: `${region.color}20`,
              borderLeft: `1px solid ${region.color}60`,
              borderRight: `1px solid ${region.color}60`,
            }}
          >
            <span className="absolute top-0 left-0.5 text-[7px] font-mono leading-tight" style={{ color: region.color }}>
              {region.label}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemoveRegion(region.id); }}
              className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
            >
              <X size={7} className="text-red-400" />
            </button>
          </div>
        ))}

        {/* Markers */}
        {markers.map((marker) => (
          <div
            key={marker.id}
            className="absolute top-0 bottom-0 w-px group cursor-pointer"
            style={{
              left: `${timeToPercent(marker.time)}%`,
              backgroundColor: marker.color,
            }}
            onMouseEnter={() => setHoveredMarker(marker.id)}
            onMouseLeave={() => setHoveredMarker(null)}
            onClick={(e) => { e.stopPropagation(); onSeek(marker.time); }}
          >
            <div
              className="absolute -top-0.5 -left-1.5 w-3 h-3 rounded-full border border-white/20"
              style={{ backgroundColor: marker.color }}
            />
            {hoveredMarker === marker.id && (
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-studio-panel border border-studio-border rounded px-1 py-0.5 text-[7px] font-mono text-studio-text whitespace-nowrap z-10">
                {marker.label} · {formatTime(marker.time)}
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveMarker(marker.id); }}
                  className="ml-1 text-red-400 hover:text-red-300"
                >
                  <Trash2 size={7} />
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Region start indicator */}
        {regionStart !== null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-studio-accent animate-pulse"
            style={{ left: `${timeToPercent(regionStart)}%` }}
          />
        )}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/60 pointer-events-none"
          style={{ left: `${timeToPercent(currentTime)}%` }}
        />
      </div>

      {/* Marker/Region list */}
      {(markers.length > 0 || regions.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {markers.map((m) => (
            <button
              key={m.id}
              onClick={() => onSeek(m.time)}
              className="px-1 py-0.5 rounded text-[7px] font-mono border border-transparent hover:border-current transition-colors"
              style={{ color: m.color }}
            >
              {m.label}
            </button>
          ))}
          {regions.map((r) => (
            <span
              key={r.id}
              className="px-1 py-0.5 rounded text-[7px] font-mono opacity-60"
              style={{ color: r.color, backgroundColor: `${r.color}15` }}
            >
              {r.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
