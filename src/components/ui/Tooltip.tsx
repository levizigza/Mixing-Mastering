'use client';

import React, { useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

export default function Tooltip({
  content,
  children,
  position = 'top',
  delay = 400,
  className,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };

  return (
    <div className={cn('relative inline-flex', className)} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && content && (
        <div
          className={cn(
            'absolute z-50 px-2 py-1 rounded bg-studio-bg border border-studio-border',
            'text-[9px] font-mono text-studio-text whitespace-nowrap pointer-events-none',
            'animate-fade-in shadow-lg',
            positionClasses[position]
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}
