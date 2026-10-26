'use client';

import React from 'react';

export { EmptyState } from './states';

/** Card frame for a data table; scrolls sideways inside itself instead of widening the page. */
export function TableShell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card w-full overflow-hidden ${className}`}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
