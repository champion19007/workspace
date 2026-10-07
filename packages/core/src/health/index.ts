import { z } from 'zod';
import {
  TaskStatusEnum,
  TaskPriorityEnum,
  parseCalendarDate,
} from '../tasks/index.js';

// 1. Health Status Domain Definition
export const HealthStatusEnum = z.enum(['no_tasks', 'on_track', 'needs_attention', 'at_risk']);
export type HealthStatus = z.infer<typeof HealthStatusEnum>;

export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  no_tasks: 'No tasks yet',
  on_track: 'On Track',
  needs_attention: 'Needs Attention',
  at_risk: 'At Risk',
};

export const HEALTH_STATUS_COLORS: Record<HealthStatus, { bg: string; text: string; border: string; dot: string }> = {
  no_tasks: {
    bg: 'bg-zinc-500/10',
    text: 'text-zinc-400',
    border: 'border-zinc-500/20',
    dot: 'bg-zinc-400',
  },
  on_track: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    dot: 'bg-emerald-400',
  },
  needs_attention: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
    dot: 'bg-amber-400',
  },
  at_risk: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    border: 'border-rose-500/20',
    dot: 'bg-rose-400',
  },
};

// 2. Rollup Structure Schemas
export const NodeRollupTasksSchema = z.object({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type NodeRollupTasks = z.infer<typeof NodeRollupTasksSchema>;

export const NodeRollupSubtasksSchema = z.object({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
});
export type NodeRollupSubtasks = z.infer<typeof NodeRollupSubtasksSchema>;

export const NodeRollupProvenanceSchema = z.object({
  computedAt: z.string(),
  rulesVersion: z.string().default('1.0.0'),
  dateContext: z.string(),
  generation: z.number().int().nonnegative().default(1),
});
export type NodeRollupProvenance = z.infer<typeof NodeRollupProvenanceSchema>;

export const NodeRollupSchema = z.object({
  health: HealthStatusEnum,
  completionPercentage: z.number().min(0).max(100),
  tasks: NodeRollupTasksSchema,
  subtasks: NodeRollupSubtasksSchema,
  overdueCount: z.number().int().nonnegative(),
  dueSoonCount: z.number().int().nonnegative(),
  unassignedCount: z.number().int().nonnegative(),
  provenance: NodeRollupProvenanceSchema,
});
export type NodeRollupDTO = z.infer<typeof NodeRollupSchema>;

/**
 * Adds N calendar days to a YYYY-MM-DD date string.
 */
export function addCalendarDays(dateStr: string, days: number): string {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return dateStr;
  const d = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pure deterministic health calculation based on active work, overdue items, and due-soon items.
 * Never uses heuristic or non-deterministic mechanisms.
 */
export function computeHealthStatus(params: {
  totalTasks: number;
  totalSubtasks: number;
  overdueCount: number;
  dueSoonCount: number;
}): HealthStatus {
  const totalActiveWork = params.totalTasks + params.totalSubtasks;
  if (totalActiveWork === 0) {
    return 'no_tasks';
  }
  if (params.overdueCount > 0) {
    return 'at_risk';
  }
  if (params.dueSoonCount > 0) {
    return 'needs_attention';
  }
  return 'on_track';
}

/**
 * Pure completion percentage calculation.
 * Top-level tasks represent the headline completion denominator.
 * Returns 0 if total is 0.
 */
export function computeCompletionPercentage(completedTasks: number, totalTasks: number): number {
  if (totalTasks <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((completedTasks / totalTasks) * 100)));
}

// 3. Activity Feed Schema
export const ActivityItemSchema = z.object({
  id: z.string().uuid(),
  verb: z.string(),
  targetType: z.string(),
  targetId: z.string().uuid(),
  targetKey: z.string().nullable().optional(),
  targetTitle: z.string().nullable().optional(),
  actor: z.object({
    id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
  details: z.record(z.unknown()).optional(),
  createdAt: z.string(),
});
export type ActivityItemDTO = z.infer<typeof ActivityItemSchema>;

// 4. Project Dashboard DTO
export const ProjectDashboardSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    keyPrefix: z.string().nullable(),
    visibility: z.enum(['public', 'private']),
    teamId: z.string().uuid().nullable(),
    teamName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  rollup: NodeRollupSchema,
  recentActivity: z.array(ActivityItemSchema),
});
export type ProjectDashboardDTO = z.infer<typeof ProjectDashboardSchema>;

// 5. Leadership Dashboard Queries & DTOs
export const LeadershipSummaryQuerySchema = z.object({
  teamId: z.string().uuid().optional(),
  health: HealthStatusEnum.optional(),
  search: z.string().trim().max(100).optional(),
});
export type LeadershipSummaryQuery = z.infer<typeof LeadershipSummaryQuerySchema>;

export const LeadershipProjectSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  keyPrefix: z.string().nullable(),
  visibility: z.enum(['public', 'private']),
  teamId: z.string().uuid().nullable(),
  teamName: z.string().nullable(),
  rollup: NodeRollupSchema,
});
export type LeadershipProjectSummaryDTO = z.infer<typeof LeadershipProjectSummarySchema>;

export const LeadershipAtRiskTaskSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  title: z.string(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  status: TaskStatusEnum,
  priority: TaskPriorityEnum,
  dueDate: z.string().nullable(),
  assignee: z.object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    email: z.string(),
  }).nullable(),
  isOverdue: z.boolean(),
  isBlocked: z.boolean(),
});
export type LeadershipAtRiskTaskDTO = z.infer<typeof LeadershipAtRiskTaskSchema>;

export const LeadershipSummarySchema = z.object({
  summary: z.object({
    totalProjects: z.number().int().nonnegative(),
    totalTasks: z.number().int().nonnegative(),
    totalOverdue: z.number().int().nonnegative(),
    totalUnassigned: z.number().int().nonnegative(),
    atRiskProjects: z.number().int().nonnegative(),
    averageCompletionPercentage: z.number().min(0).max(100),
  }),
  projects: z.array(LeadershipProjectSummarySchema),
  atRiskTasks: z.array(LeadershipAtRiskTaskSchema),
});
export type LeadershipSummaryDTO = z.infer<typeof LeadershipSummarySchema>;
