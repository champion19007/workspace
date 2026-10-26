import { z } from 'zod';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

// 1. Central Domain Enums & Constants
export const TaskStatusEnum = z.enum(['todo', 'in_progress', 'done', 'blocked']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskPriorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPriorityEnum>;

export const TaskSourceEnum = z.enum(['manual', 'zoom_meeting']);
export type TaskSource = z.infer<typeof TaskSourceEnum>;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

// 2. Calendar Date Helpers (Date-only calendar validation without UTC shifting)
export function parseCalendarDate(dateStr?: string | null): { year: number; month: number; day: number } | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);

  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Calendar day boundary validation (leap years, 30 vs 31 days)
  const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]!) return null;

  return { year, month, day };
}

/**
 * The time zone that decides what "today" means for due dates and overdue work, the same for everyone on a
 * deployment. Set NEXT_PUBLIC_APP_TIME_ZONE to an IANA name (e.g. America/New_York); the NEXT_PUBLIC_ prefix lets
 * the browser use the same zone as the server. Defaults to Asia/Kolkata, which an unknown name also falls back to.
 */
export const APP_TIME_ZONE: string = (() => {
  const zone = process.env.NEXT_PUBLIC_APP_TIME_ZONE;
  if (!zone) return 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return zone;
  } catch {
    return 'Asia/Kolkata';
  }
})();

/**
 * Returns today's date formatted as YYYY-MM-DD in the deployment's time zone (APP_TIME_ZONE; Asia/Kolkata by default).
 */
export function getKolkataTodayDateString(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * Returns true if the due date is strictly before today in Asia/Kolkata.
 */
export function isDateOverdue(dueDate?: string | null, today = getKolkataTodayDateString()): boolean {
  if (!dueDate) return false;
  return dueDate < today;
}

/**
 * Formats a calendar date relative to today in Asia/Kolkata.
 */
export function formatRelativeDueDate(dueDate?: string | null, today = getKolkataTodayDateString()): string {
  if (!dueDate) return 'No deadline';
  if (dueDate === today) return 'Today';

  const dueParsed = parseCalendarDate(dueDate);
  const todayParsed = parseCalendarDate(today);
  if (!dueParsed || !todayParsed) return dueDate;

  const dueTime = Date.UTC(dueParsed.year, dueParsed.month - 1, dueParsed.day);
  const todayTime = Date.UTC(todayParsed.year, todayParsed.month - 1, todayParsed.day);
  const diffDays = Math.round((dueTime - todayTime) / (1000 * 60 * 60 * 24));

  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays <= 7) return `In ${diffDays}d`;

  return dueDate;
}

// 3. Project Key Prefix Helpers
export function isValidKeyPrefix(prefix: string): boolean {
  return /^[A-Z][A-Z0-9]{1,9}$/.test(prefix);
}

export function sanitizeKeyPrefix(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length < 2) return 'PRJ';
  return clean.slice(0, 4);
}

// 4. Fractional Rank Helpers (Base-62 Fractional Indexing via rocicorp/fractional-indexing)
export const MAX_RANK_LENGTH = 32;

/**
 * Returns the default initial rank for the first task in an ordering scope.
 * In base-62 fractional-indexing, this produces 'a0'.
 */
export function generateInitialRank(): string {
  return generateKeyBetween(null, null);
}

/**
 * Generates an authoritative base-62 fractional key strictly between prevRank and nextRank.
 * If prevRank is omitted, generates a key before nextRank.
 * If nextRank is omitted, generates a key after prevRank.
 * Uses exact case-sensitive byte ordering matching PostgreSQL COLLATE "C".
 */
export function generateRankBetween(prevRank?: string | null, nextRank?: string | null): string {
  const p = prevRank && prevRank.trim() ? prevRank.trim() : null;
  const n = nextRank && nextRank.trim() ? nextRank.trim() : null;
  return generateKeyBetween(p, n);
}

/**
 * Compares two ranks using case-sensitive ASCII lexical comparison matching PostgreSQL COLLATE "C".
 */
export function compareRanks(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Checks whether a rank exceeds the dense rank threshold (32 characters), indicating rebalancing is recommended.
 */
export function isDenseRank(rank: string): boolean {
  return rank.length > MAX_RANK_LENGTH;
}

/**
 * Generates N evenly spaced base-62 fractional index keys for rebalancing a column.
 */
export function generateRebalancedRanks(count: number): string[] {
  if (count <= 0) return [];
  return generateNKeysBetween(null, null, count);
}

// 5. Zod Schemas for Tasks
export const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Deadline must be formatted as YYYY-MM-DD')
  .refine((val) => parseCalendarDate(val) !== null, 'Invalid calendar date')
  .nullable();

export const CreateTaskSchema = z.object({
  projectId: z.string().uuid('Project ID must be a valid UUID'),
  title: z
    .string()
    .trim()
    .min(1, 'Task title is required')
    .max(500, 'Task title cannot exceed 500 characters'),
  description: z.string().max(50000, 'Description cannot exceed 50000 characters').nullable().optional(),
  status: TaskStatusEnum.default('todo'),
  priority: TaskPriorityEnum.default('medium'),
  assigneeId: z.string().uuid('Assignee ID must be a valid UUID').nullable().optional(),
  dueDate: CalendarDateSchema.optional(),
  parentTaskId: z.string().uuid('Parent task ID must be a valid UUID').nullable().optional(),
  labelIds: z.array(z.string().uuid()).max(20, 'Maximum 20 labels per task').optional(),
  source: z.literal('manual').optional(),
  sourceRef: z.string().max(128).optional(),
}).superRefine((data, ctx) => {
  if ((data as any).source && (data as any).source !== 'manual') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Client cannot set source or forge AI provenance for manual task creation',
      path: ['source'],
    });
  }
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Task title cannot be empty')
    .max(500, 'Task title cannot exceed 500 characters')
    .optional(),
  description: z.string().max(50000, 'Description cannot exceed 50000 characters').nullable().optional(),
  status: TaskStatusEnum.optional(),
  priority: TaskPriorityEnum.optional(),
  assigneeId: z.string().uuid('Assignee ID must be a valid UUID').nullable().optional(),
  dueDate: CalendarDateSchema.optional(),
  parentTaskId: z.string().uuid('Parent task ID must be a valid UUID').nullable().optional(),
  labelIds: z.array(z.string().uuid()).max(20).optional(),
  rank: z.string().max(128).optional(),
  prevTaskId: z.string().uuid('Previous task ID must be a valid UUID').nullable().optional(),
  nextTaskId: z.string().uuid('Next task ID must be a valid UUID').nullable().optional(),
  source: z.never().optional(),
  sourceRef: z.never().optional(),
});

export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export const MoveTaskSchema = z.object({
  status: TaskStatusEnum.optional(),
  prevTaskId: z.string().uuid('Previous task ID must be a valid UUID').nullable().optional(),
  nextTaskId: z.string().uuid('Next task ID must be a valid UUID').nullable().optional(),
  targetRank: z.string().max(128).optional(),
});

export type MoveTaskInput = z.infer<typeof MoveTaskSchema>;

export const CreateSubtaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Subtask title is required')
    .max(500, 'Subtask title cannot exceed 500 characters'),
  description: z.string().max(50000).nullable().optional(),
  status: TaskStatusEnum.default('todo'),
  priority: TaskPriorityEnum.default('medium'),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: CalendarDateSchema.optional(),
  labelIds: z.array(z.string().uuid()).max(20).optional(),
});

export type CreateSubtaskInput = z.infer<typeof CreateSubtaskSchema>;

export const ListTasksQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: TaskStatusEnum.optional(),
  priority: TaskPriorityEnum.optional(),
  assigneeId: z.string().uuid().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
  includeArchived: z.preprocess((val) => val === 'true' || val === true, z.boolean()).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

// 6. Labels Schemas
export const CreateLabelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Label name is required')
    .max(64, 'Label name cannot exceed 64 characters'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Label color must be a valid hex code (e.g. #38BDF8)')
    .default('#64748B'),
});

export type CreateLabelInput = z.infer<typeof CreateLabelSchema>;

export const UpdateLabelSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export type UpdateLabelInput = z.infer<typeof UpdateLabelSchema>;

// 7. Output DTO Types
export interface TaskLabelDTO {
  id: string;
  name: string;
  color: string;
}

export interface TaskAssigneeDTO {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface TaskDTO {
  id: string;
  orgId: string;
  projectId: string;
  parentTaskId: string | null;
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assignee?: TaskAssigneeDTO | null;
  dueDate: string | null;
  rank: string;
  version: number;
  source: string;
  sourceRef: string | null;
  createdBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labels: TaskLabelDTO[];
  subtaskCount?: number;
}

// 8. My Tasks Schemas and DTOs
export const MyTasksCategoryEnum = z.enum(['all', 'pending', 'overdue', 'due_today', 'upcoming']);
export type MyTasksCategory = z.infer<typeof MyTasksCategoryEnum>;

export const MyTasksQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: TaskStatusEnum.optional(),
  priority: TaskPriorityEnum.optional(),
  category: MyTasksCategoryEnum.default('all'),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type MyTasksQuery = z.infer<typeof MyTasksQuerySchema>;

export interface MyTasksCountsDTO {
  all: number;
  pending: number;
  overdue: number;
  dueToday: number;
  upcoming: number;
}

export interface MyTaskItemDTO extends TaskDTO {
  projectName: string;
  projectKeyPrefix: string;
  parentKey?: string | null;
  parentTitle?: string | null;
}

export interface MyTasksResponseDTO {
  tasks: MyTaskItemDTO[];
  counts: MyTasksCountsDTO;
  nextCursor: string | null;
}

