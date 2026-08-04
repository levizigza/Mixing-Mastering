'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
  progress?: number;
}

export default function LoadingOverlay({ isLoading, message = 'Loading...', progress }: LoadingOverlayProps) {
  if (!isLoading) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-studio-bg/80 backdrop-blur-sm rounded-lg animate-fade-in">
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-8 h-8">
          <div className="absolute inset-0 border-2 border-studio-border rounded-full" />
          <div className="absolute inset-0 border-2 border-transparent border-t-studio-accent rounded-full animate-spin" />
        </div>
        <span className="text-[10px] font-mono text-studio-muted">{message}</span>
        {progress !== undefined && (
          <div className="w-24 h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-studio-accent rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
