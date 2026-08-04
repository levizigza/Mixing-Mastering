'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Film, Link2 } from 'lucide-react';

interface VideoSyncPanelProps {
  isPlaying: boolean;
  currentTime: number;
  videoOffsetMs: number;
  onOffsetChange: (ms: number) => void;
  onVideoLoaded?: (duration: number) => void;
}

export default function VideoSyncPanel({
  isPlaying,
  currentTime,
  videoOffsetMs,
  onOffsetChange,
  onVideoLoaded,
}: VideoSyncPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !hasVideo) return;
    const target = Math.max(0, currentTime + videoOffsetMs / 1000);
    if (Math.abs(v.currentTime - target) > 0.12) {
      v.currentTime = target;
    }
    if (isPlaying && v.paused) void v.play().catch(() => {});
    if (!isPlaying && !v.paused) v.pause();
  }, [currentTime, isPlaying, videoOffsetMs, hasVideo]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !videoRef.current) return;
    const url = URL.createObjectURL(file);
    videoRef.current.src = url;
    setName(file.name);
    setHasVideo(true);
    videoRef.current.onloadedmetadata = () => {
      onVideoLoaded?.(videoRef.current?.duration ?? 0);
    };
  };

  return (
    <div className="studio-panel p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-display text-[9px] tracking-[0.18em] text-sky-400">VIDEO SYNC</p>
        <Film size={12} className="text-sky-400/70" />
      </div>
      <video ref={videoRef} className="w-full rounded border border-studio-border bg-black max-h-28" muted playsInline />
      <label className="flex items-center justify-center gap-1.5 py-1.5 rounded border border-dashed border-studio-border text-[9px] font-mono text-studio-muted cursor-pointer hover:border-sky-500/40">
        <Link2 size={11} />
        {hasVideo ? name.slice(0, 22) : 'LOAD VIDEO'}
        <input type="file" accept="video/*" className="hidden" onChange={onFile} />
      </label>
      <div className="flex items-center gap-2">
        <span className="text-[8px] font-mono text-studio-muted w-14">OFFSET MS</span>
        <input
          type="range"
          min={-2000}
          max={2000}
          value={videoOffsetMs}
          onChange={(e) => onOffsetChange(Number(e.target.value))}
          className="flex-1 h-1 accent-sky-400"
        />
        <span className="text-[8px] font-mono text-studio-muted w-10 text-right">{videoOffsetMs}</span>
      </div>
    </div>
  );
}
