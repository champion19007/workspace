import { formatRelativeDueDate, isDateOverdue, parseCalendarDate } from '@workspace/core';

/** "2026-10-28" -> "Oct 28" (adds the year when it isn't the current one). */
export function formatShortDate(dateStr: string): string {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return dateStr;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  const sameYear = parsed.year === new Date().getUTCFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date);
}

/** Due-date wording for task rows. Done tasks are never "overdue". */
export function dueLabel(dueDate: string | null | undefined, done = false): { text: string; overdue: boolean; soon: boolean } {
  if (!dueDate) return { text: '', overdue: false, soon: false };
  if (done) return { text: formatShortDate(dueDate), overdue: false, soon: false };
  if (isDateOverdue(dueDate)) return { text: `Overdue · ${formatShortDate(dueDate)}`, overdue: true, soon: false };
  const relative = formatRelativeDueDate(dueDate);
  if (relative === 'Today' || relative === 'Tomorrow') return { text: relative, overdue: false, soon: true };
  return { text: formatShortDate(dueDate), overdue: false, soon: false };
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function formatRelativeTime(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(diffSec)) return iso;
  if (diffSec < 60) return 'just now';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso));
}

/** "Oct 23, 3:00 PM" in the viewer's time zone. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
