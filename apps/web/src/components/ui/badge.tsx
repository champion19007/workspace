'use client';

import React from 'react';
import {
  Circle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Flame,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  ShieldAlert,
  ShieldCheck,
  User,
  Eye,
} from 'lucide-react';

export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

export function StatusBadge({
  status,
  size = 'md',
}: {
  status: TaskStatus;
  size?: 'sm' | 'md';
}) {
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';

  switch (status) {
    case 'todo':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-slate-800 text-slate-300 border border-slate-700 ${sizeClasses}`}
        >
          <Circle className="w-3 h-3 text-slate-400" />
          <span>To Do</span>
        </span>
      );
    case 'in_progress':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30 ${sizeClasses}`}
        >
          <Clock className="w-3 h-3 text-amber-400 animate-pulse" />
          <span>In Progress</span>
        </span>
      );
    case 'completed':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 ${sizeClasses}`}
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>Completed</span>
        </span>
      );
    case 'blocked':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-rose-500/10 text-rose-300 border border-rose-500/30 ${sizeClasses}`}
        >
          <AlertTriangle className="w-3 h-3 text-rose-400" />
          <span>Blocked</span>
        </span>
      );
    case 'cancelled':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-slate-800/60 text-slate-400 border border-slate-700/60 ${sizeClasses}`}
        >
          <Circle className="w-3 h-3 text-slate-500 line-through" />
          <span>Cancelled</span>
        </span>
      );
    default:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-slate-800 text-slate-400 ${sizeClasses}`}>
          <span>{status}</span>
        </span>
      );
  }
}

export function PriorityBadge({
  priority,
  size = 'md',
}: {
  priority: TaskPriority;
  size?: 'sm' | 'md';
}) {
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';

  switch (priority) {
    case 'urgent':
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 ${sizeClasses}`}
        >
          <Flame className="w-3 h-3 text-rose-400" />
          <span>Urgent</span>
        </span>
      );
    case 'high':
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 ${sizeClasses}`}
        >
          <ArrowUp className="w-3 h-3 text-amber-400" />
          <span>High</span>
        </span>
      );
    case 'medium':
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20 ${sizeClasses}`}
        >
          <ArrowRight className="w-3 h-3 text-blue-400" />
          <span>Medium</span>
        </span>
      );
    case 'low':
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md font-medium bg-slate-800 text-slate-400 border border-slate-700 ${sizeClasses}`}
        >
          <ArrowDown className="w-3 h-3 text-slate-400" />
          <span>Low</span>
        </span>
      );
    default:
      return <span className={`text-slate-400 ${sizeClasses}`}>{priority}</span>;
  }
}

export function RoleBadge({
  role,
}: {
  role: OrgRole | string;
}) {
  switch (role) {
    case 'owner':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-accent/15 text-accent border border-accent/30 capitalize">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Owner</span>
        </span>
      );
    case 'admin':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 capitalize">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Admin</span>
        </span>
      );
    case 'member':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 capitalize">
          <User className="w-3.5 h-3.5 text-slate-400" />
          <span>Member</span>
        </span>
      );
    case 'viewer':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 capitalize">
          <Eye className="w-3.5 h-3.5 text-zinc-400" />
          <span>Viewer</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 capitalize">
          {role}
        </span>
      );
  }
}
