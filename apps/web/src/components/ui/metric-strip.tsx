'use client';

import React from 'react';
import Link from 'next/link';

export type MetricDotColor = 'accent' | 'amber' | 'emerald' | 'indigo' | 'rose' | 'neutral';

export interface MetricItem {
  id: string;
  label: string;
  value: number | string;
  dotColor: MetricDotColor;
  subtext?: string;
  change?: string;
  href?: string;
}

const DOT_COLOR_MAP: Record<MetricDotColor, string> = {
  accent: 'bg-accent',
  amber: 'bg-warning',
  emerald: 'bg-success',
  indigo: 'bg-info',
  rose: 'bg-danger',
  neutral: 'bg-fg-subtle',
};

export function MetricCard({ item }: { item: MetricItem }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_COLOR_MAP[item.dotColor]}`} aria-hidden="true" />
          <span className="truncate">{item.label}</span>
        </span>
        {item.change && <span className="badge badge-neutral">{item.change}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-fg">{item.value}</div>
      {item.subtext && <p className="mt-0.5 truncate text-xs text-fg-muted">{item.subtext}</p>}
    </>
  );

  return item.href ? (
    <Link href={item.href} className="card block p-4 transition-colors hover:border-border-strong hover:bg-surface-2/50">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
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
    <div className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${className}`}>
      {items.map((item) => (
        <MetricCard key={item.id} item={item} />
      ))}
    </div>
  );
}
