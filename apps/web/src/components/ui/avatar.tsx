import React from 'react';

export function initialsOf(nameOrEmail: string): string {
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0]! : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : base.slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** Stable hue per person, so the same teammate always gets the same colour. */
function hueOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

const SIZE = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

/**
 * Initials avatar. Decorative by default (the name is shown next to it); pass `label` when the
 * avatar stands alone so screen readers and tooltips get the person's name.
 */
export function Avatar({
  name,
  size = 'md',
  label,
  className = '',
}: {
  name: string;
  size?: keyof typeof SIZE;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`avatar ${SIZE[size]} ${className}`}
      style={{ '--avatar-hue': hueOf(name) } as React.CSSProperties}
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
    >
      {initialsOf(name)}
    </span>
  );
}
