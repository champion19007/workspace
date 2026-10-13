'use client';

import React, { useEffect, useRef } from 'react';
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
  // Latest onClose without re-running the open effect (which would steal focus on every parent render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (isOpen) {
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
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby={description ? 'dialog-description' : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div
        ref={dialogRef}
        className={`relative z-10 w-full ${maxWidthClass} max-h-[90vh] overflow-y-auto bg-panel border border-border-subtle rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150`}
      >
        <div className="flex items-start justify-between p-5 border-b border-border-subtle">
          <div>
            <h2 id="dialog-title" className="text-lg font-bold text-foreground">
              {title}
            </h2>
            {description && (
              <p id="dialog-description" className="text-xs text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
