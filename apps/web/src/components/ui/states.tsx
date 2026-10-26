'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Info, RotateCw, X, type LucideIcon } from 'lucide-react';

interface StateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  primary?: boolean;
}

function ActionButton({ action }: { action: StateAction }) {
  const className = `btn btn-sm mt-4 ${action.primary ? 'btn-primary' : 'btn-secondary'}`;
  return action.href ? (
    <Link href={action.href} className={className}>
      {action.label}
    </Link>
  ) : (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  );
}

/** What will appear here, and how to add the first item. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: StateAction;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong text-center ${
        compact ? 'px-4 py-8' : 'px-6 py-14'
      }`}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p>
      {action && <ActionButton action={action} />}
    </div>
  );
}

/** A failed load: what went wrong and a way to try again. */
export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
  compact = false,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center rounded-xl border border-border bg-surface text-center ${
        compact ? 'px-4 py-8' : 'px-6 py-14'
      }`}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-danger-subtle text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        {message || 'Something went wrong on our side. Your data is safe.'}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm mt-4">
          <RotateCw aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}

const ALERT_TONE = {
  danger: { className: 'border-danger/30 bg-danger-subtle text-danger', icon: AlertTriangle },
  warning: { className: 'border-warning/30 bg-warning-subtle text-warning', icon: AlertTriangle },
  info: { className: 'border-info/30 bg-info-subtle text-info', icon: Info },
  success: { className: 'border-success/30 bg-success-subtle text-success', icon: CheckCircle2 },
} as const;

/** Inline message banner (form errors, conflicts, confirmations). */
export function Alert({
  tone = 'danger',
  title,
  children,
  onDismiss,
  action,
  className = '',
}: {
  tone?: keyof typeof ALERT_TONE;
  title?: string;
  children?: React.ReactNode;
  onDismiss?: () => void;
  action?: React.ReactNode;
  className?: string;
}) {
  const { className: toneClass, icon: Icon } = ALERT_TONE[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${toneClass} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'text-fg-muted' : ''}>{children}</div>}
      </div>
      {action}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 rounded p-1 opacity-80 hover:opacity-100"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Placeholder rows while a list loads. */
export function SkeletonRows({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={`card divide-y divide-border overflow-hidden ${className}`}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="skeleton h-4 w-4 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3" style={{ width: `${70 - ((i * 13) % 30)}%` }} />
            <div className="skeleton h-2.5 w-1/4" />
          </div>
          <div className="skeleton hidden h-5 w-20 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder cards while a grid loads. */
export function SkeletonCards({ count = 3, className = '' }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card space-y-3 p-4">
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}
