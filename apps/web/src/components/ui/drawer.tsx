'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { trapTabKey } from './dialog';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  widthClass?: string;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  widthClass = 'max-w-md w-full',
}: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  // Latest onClose without re-running the open effect (which would steal focus on every parent render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (isOpen) {
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
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      aria-describedby={description ? 'drawer-description' : undefined}
      className="fixed inset-0 z-50 flex justify-end"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out Panel */}
      <div
        ref={drawerRef}
        className={`relative z-10 flex flex-col h-full bg-panel border-l border-border-subtle shadow-2xl transition-transform duration-200 ease-out ${widthClass}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border-subtle">
          <div>
            <h2 id="drawer-title" className="text-lg font-bold text-foreground">
              {title}
            </h2>
            {description && (
              <p id="drawer-description" className="text-xs text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}
