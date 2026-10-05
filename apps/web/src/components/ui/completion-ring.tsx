'use client';

import React from 'react';

interface CompletionRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
}

export function CompletionRing({
  percentage,
  size = 140,
  strokeWidth = 10,
  label = 'COMPLETE',
  className = '',
}: CompletionRingProps) {
  const clamped = Math.min(100, Math.max(0, percentage));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Project completion: ${clamped}%`}
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          className="text-border-subtle"
        />
        {/* Accent progress stroke */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--accent, #d86dfc)"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-500 ease-out"
        />
      </svg>

      {/* Center percentage readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none">
        <span className="text-2xl font-bold tracking-tight text-foreground font-mono">
          {clamped}%
        </span>
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase mt-0.5">
          {label}
        </span>
      </div>
    </div>
  );
}
