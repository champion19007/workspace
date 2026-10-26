'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { trapTabKey } from './dialog';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Pinned below the scrolling body (primary actions). */
  footer?: React.ReactNode;
  widthClass?: string;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  widthClass = 'max-w-md w-full',
}: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  // Latest onClose without re-running the open effect (which would steal focus on every parent render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  // Rendered into <body> so a parent's layout (space-y margins, transforms) can't shift the fixed overlay.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isOpen && mounted) {
      previouslyFocusedElement.current = document.activeElement as HTMLElement;
      // Focus drawer on open
      const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onCloseRef.current();
        } else if (e.key === 'Tab') {
          trapTabKey(e, drawerRef.current);
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
        previouslyFocusedElement.current?.focus();
      };
    }
  }, [isOpen, mounted]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="fixed inset-0 z-50 flex justify-end"
    >
      <div className="fixed inset-0 animate-fade-in bg-overlay/40" onClick={onClose} aria-hidden="true" />

      {/* Full screen on phones, side panel from sm up. */}
      <div
        ref={drawerRef}
        className={`relative z-10 flex h-full animate-slide-in-right flex-col border-l border-border bg-surface shadow-2xl ${widthClass}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-sm text-fg-muted">
                {description}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close panel" className="btn btn-ghost btn-icon btn-sm -mr-1.5">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex items-center gap-2 border-t border-border bg-surface px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
