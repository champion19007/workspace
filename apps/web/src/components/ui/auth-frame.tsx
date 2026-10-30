'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

const ICON_TONE = {
  accent: 'bg-accent-subtle text-accent-text',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
} as const;

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-fg ${className}`}
    >
      W
    </span>
  );
}

/** Centered single-card layout for pages outside the app shell: sign-in, invitations, onboarding. */
export function AuthFrame({
  title,
  description,
  icon: Icon,
  tone = 'accent',
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof ICON_TONE;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Workspace`;
  }, [title]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mx-auto mb-8 flex w-fit items-center gap-2 rounded-md font-semibold text-fg">
          <BrandMark />
          Workspace
        </Link>

        <div className="mb-6 space-y-2 text-center">
          {Icon && (
            <div className={`mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${ICON_TONE[tone]}`}>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
          <h1 className="text-balance text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="text-pretty text-sm text-fg-muted">{description}</p>}
        </div>

        {children && <div className="card space-y-4 p-6">{children}</div>}
        {footer && <div className="mt-6 text-center text-sm text-fg-muted">{footer}</div>}
      </div>
    </main>
  );
}

/** Suspense fallback for the pages above, which read the URL with useSearchParams. */
export function AuthFrameFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    </main>
  );
}
