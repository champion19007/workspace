'use client';

import React from 'react';
import {
  Circle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Flame,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  ShieldAlert,
  ShieldCheck,
  User,
  Eye,
  Briefcase,
  FileText,
  MinusCircle,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import type { HealthStatus, OrgRole, ZoomMeetingStatus } from '@workspace/core';

export type { OrgRole };

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'completed' | 'blocked' | 'cancelled';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'badge-neutral',
  accent: 'badge-accent',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
};

export function Badge({
  children,
  variant = 'neutral',
  icon: Icon,
  className = '',
  title,
}: {
  children: React.ReactNode;
  variant?: Tone | 'default';
  icon?: LucideIcon;
  className?: string;
  title?: string;
}) {
  const tone = variant === 'default' ? 'neutral' : variant;
  return (
    <span className={`badge ${TONE_CLASS[tone]} ${className}`} title={title}>
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </span>
  );
}

const STATUS_META: Record<TaskStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  todo: { label: 'To do', tone: 'neutral', icon: Circle },
  in_progress: { label: 'In progress', tone: 'info', icon: Clock },
  done: { label: 'Done', tone: 'success', icon: CheckCircle2 },
  completed: { label: 'Done', tone: 'success', icon: CheckCircle2 },
  blocked: { label: 'Blocked', tone: 'danger', icon: Ban },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: MinusCircle },
};

export function statusLabel(status: string): string {
  return STATUS_META[status as TaskStatus]?.label ?? status;
}

export function StatusBadge({ status, size = 'md' }: { status: TaskStatus; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'neutral' as Tone, icon: Circle };
  return (
    <Badge variant={meta.tone} icon={meta.icon} className={size === 'sm' ? 'h-5 px-1.5' : ''}>
      {meta.label}
    </Badge>
  );
}

const PRIORITY_META: Record<TaskPriority, { label: string; tone: Tone; icon: LucideIcon }> = {
  urgent: { label: 'Urgent', tone: 'danger', icon: Flame },
  high: { label: 'High', tone: 'warning', icon: ArrowUp },
  medium: { label: 'Medium', tone: 'neutral', icon: ArrowRight },
  low: { label: 'Low', tone: 'neutral', icon: ArrowDown },
};

export function PriorityBadge({ priority, size = 'md' }: { priority: TaskPriority; size?: 'sm' | 'md' }) {
  const meta = PRIORITY_META[priority] ?? { label: priority, tone: 'neutral' as Tone, icon: ArrowRight };
  return (
    <Badge variant={meta.tone} icon={meta.icon} className={size === 'sm' ? 'h-5 px-1.5' : ''}>
      {meta.label}
    </Badge>
  );
}

const ROLE_META: Record<OrgRole, { label: string; tone: Tone; icon: LucideIcon }> = {
  owner: { label: 'Owner', tone: 'accent', icon: ShieldAlert },
  admin: { label: 'Manager', tone: 'info', icon: ShieldCheck },
  member: { label: 'Developer', tone: 'neutral', icon: User },
  viewer: { label: 'Executive', tone: 'neutral', icon: Eye },
  client: { label: 'Client', tone: 'neutral', icon: Briefcase },
};

export function RoleBadge({ role }: { role: OrgRole | string }) {
  const meta = ROLE_META[role as OrgRole];
  if (!meta) return <Badge>{role}</Badge>;
  return (
    <Badge variant={meta.tone} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

export const HEALTH_META: Record<HealthStatus, { label: string; tone: Tone; icon: LucideIcon; dot: string }> = {
  no_tasks: { label: 'No tasks', tone: 'neutral', icon: MinusCircle, dot: 'bg-fg-subtle' },
  on_track: { label: 'On track', tone: 'success', icon: CheckCircle2, dot: 'bg-success' },
  needs_attention: { label: 'Needs attention', tone: 'warning', icon: AlertTriangle, dot: 'bg-warning' },
  at_risk: { label: 'At risk', tone: 'danger', icon: AlertTriangle, dot: 'bg-danger' },
};

export function HealthBadge({ health }: { health: HealthStatus }) {
  const meta = HEALTH_META[health] ?? HEALTH_META.no_tasks;
  return (
    <Badge variant={meta.tone} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

/** Every meeting lifecycle state, in words a meeting attendee recognises. */
export const MEETING_STATUS_META: Record<ZoomMeetingStatus, { label: string; tone: Tone; icon: LucideIcon; hint: string }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral', icon: Clock, hint: 'The meeting has not happened yet.' },
  waiting_for_transcript: { label: 'Waiting for transcript', tone: 'neutral', icon: Clock, hint: 'Zoom is still processing the recording.' },
  pending_consent: { label: 'Needs consent', tone: 'warning', icon: ShieldAlert, hint: 'The host has not opted in to transcript capture.' },
  ready_for_transcript_retrieval: { label: 'Fetching transcript', tone: 'info', icon: Loader2, hint: 'The transcript is being downloaded.' },
  ingesting: { label: 'Fetching transcript', tone: 'info', icon: Loader2, hint: 'The transcript is being downloaded.' },
  transcript_ready: { label: 'Transcript ready', tone: 'info', icon: FileText, hint: 'The transcript is in; it will be matched to a project next.' },
  routing: { label: 'Finding project', tone: 'info', icon: Loader2, hint: 'Matching the meeting to a project.' },
  awaiting_project_choice: { label: 'Pick a project', tone: 'warning', icon: AlertTriangle, hint: 'Choose which project this meeting belongs to.' },
  routed: { label: 'Writing notes', tone: 'info', icon: Loader2, hint: 'Notes and suggested action items are being written.' },
  extracting: { label: 'Writing notes', tone: 'info', icon: Loader2, hint: 'Notes and suggested action items are being written.' },
  completed: { label: 'Notes ready', tone: 'success', icon: CheckCircle2, hint: 'Notes are written; review the suggested action items.' },
  failed: { label: 'Failed', tone: 'danger', icon: AlertTriangle, hint: 'Processing failed. Retry from the meeting details.' },
  intake_failed: { label: 'Import failed', tone: 'danger', icon: AlertTriangle, hint: 'The recording could not be imported from Zoom.' },
  connection_requires_reconnection: { label: 'Reconnect Zoom', tone: 'warning', icon: AlertTriangle, hint: 'The Zoom connection needs to be authorised again.' },
  skipped: { label: 'Skipped', tone: 'neutral', icon: MinusCircle, hint: 'This meeting was excluded from processing.' },
};

export function MeetingStatusBadge({ status }: { status: ZoomMeetingStatus | string }) {
  const meta = MEETING_STATUS_META[status as ZoomMeetingStatus];
  if (!meta) return <Badge>{status}</Badge>;
  return (
    <Badge variant={meta.tone} icon={meta.icon} title={meta.hint}>
      {meta.label}
    </Badge>
  );
}
