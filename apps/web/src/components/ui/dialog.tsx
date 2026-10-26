'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab / Shift+Tab focus cycling inside a modal container (WCAG 2.1 focus order for modals). */
export function trapTabKey(e: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (!container.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidthClass = 'max-w-lg',
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
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
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      firstFocusable?.focus();

      // Capture phase + stopPropagation: a dialog opened over a drawer handles Escape/Tab itself,
      // so only the topmost modal closes and focus stays trapped inside it.
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCloseRef.current();
        } else if (e.key === 'Tab') {
          e.stopPropagation();
          trapTabKey(e, dialogRef.current);
        }
      };

      window.addEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = 'hidden';

      return () => {
        window.removeEventListener('keydown', handleKeyDown, true);
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
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
    >
      <div className="fixed inset-0 animate-fade-in bg-overlay/50" onClick={onClose} aria-hidden="true" />

      {/* Bottom sheet on phones, centred card from sm up. */}
      <div
        ref={dialogRef}
        className={`relative z-10 max-h-[92vh] w-full ${maxWidthClass} animate-pop-in overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-xl`}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-fg-muted">
                {description}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="btn btn-ghost btn-icon btn-sm -mr-1.5 -mt-1">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 pb-5 pt-2">{children}</div>
      </div>
    </div>,
    document.body
  );
}
