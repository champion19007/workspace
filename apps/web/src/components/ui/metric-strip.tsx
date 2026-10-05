'use client';

import React from 'react';

export type MetricDotColor = 'accent' | 'amber' | 'emerald' | 'indigo' | 'rose';

export interface MetricItem {
  id: string;
  label: string;
  value: number | string;
  dotColor: MetricDotColor;
  subtext?: string;
  change?: string;
}

const DOT_COLOR_MAP: Record<MetricDotColor, string> = {
  accent: 'bg-accent shadow-[0_0_8px_var(--accent,#d86dfc)]',
  amber: 'bg-amber-400 shadow-[0_0_8px_#fbbf24]',
  emerald: 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
  indigo: 'bg-indigo-400 shadow-[0_0_8px_#818cf8]',
  rose: 'bg-rose-400 shadow-[0_0_8px_#f43f5e]',
};

export function MetricCard({ item }: { item: MetricItem }) {
  return (
    <div className="bg-panel border border-border-subtle hover:border-border-strong rounded-xl p-4 transition-all duration-150 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full inline-block shrink-0 ${DOT_COLOR_MAP[item.dotColor] || 'bg-slate-400'}`}
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
            {item.label}
          </span>
        </div>
        {item.change && (
          <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
            {item.change}
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between mt-1">
        <span className="text-2xl font-bold tracking-tight text-foreground font-mono">
          {item.value}
        </span>
        {item.subtext && (
          <span className="text-xs text-muted-foreground truncate">
            {item.subtext}
          </span>
        )}
      </div>
    </div>
  );
}

export function MetricStrip({
  items,
  className = '',
}: {
  items: MetricItem[];
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 ${className}`}
    >
      {items.map((item) => (
        <MetricCard key={item.id} item={item} />
      ))}
    </div>
  );
}
