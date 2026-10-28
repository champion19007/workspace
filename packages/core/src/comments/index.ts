import { z } from 'zod';

// ============================================================================
// Comments
// ============================================================================

export const MAX_COMMENT_LENGTH = 10_000;
export const MAX_COMMENT_MENTIONS = 20;

/** What people can comment on. `node` is a project's Discussion. */
export const CommentTargetTypeSchema = z.enum(['task', 'node', 'doc']);
export type CommentTargetType = z.infer<typeof CommentTargetTypeSchema>;

export const CommentTargetQuerySchema = z.object({
  targetType: CommentTargetTypeSchema,
  targetId: z.string().uuid(),
});

export const CreateCommentSchema = CommentTargetQuerySchema.extend({
  bodyMd: z.string().trim().min(1, 'Write something first').max(MAX_COMMENT_LENGTH),
  mentions: z.array(z.string().uuid()).max(MAX_COMMENT_MENTIONS).default([]),
});
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

/** A person as other members see them: a display name, never an email address. */
export interface PersonDTO {
  id: string;
  name: string;
}

export interface CommentDTO {
  id: string;
  targetType: CommentTargetType;
  targetId: string;
  author: PersonDTO;
  bodyMd: string;
  mentions: PersonDTO[];
  createdAt: string;
  canDelete: boolean;
}

export interface CommentRecipientInput {
  /** Who wrote the new comment. */
  authorId: string;
  /** People tagged with @ in the new comment. */
  mentionedIds: string[];
  /** People who commented on the same task, project or doc before, oldest first. */
  earlierCommenterIds: string[];
  /** Who the task is assigned to; null for projects and docs. */
  assigneeId: string | null;
  /** Who created the task, doc or project. */
  creatorId: string | null;
}

/**
 * Who hears about a new comment. The caller then drops anyone who can't see the task, project or doc, and gives
 * the people who were @mentioned a "mentioned you" notification instead of "commented on".
 */
export function commentRecipients(input: CommentRecipientInput): string[] {
  // People in a long thread hear about it only while they're among its latest voices.
  const recentCommenters = input.earlierCommenterIds.slice(-MAX_THREAD_RECIPIENTS);
  const candidates = [...input.mentionedIds, input.assigneeId, input.creatorId, ...recentCommenters];
  return [...new Set(candidates.filter((id): id is string => !!id && id !== input.authorId))];
}

/** How many earlier commenters a new comment notifies. */
export const MAX_THREAD_RECIPIENTS = 10;

// ============================================================================
// Notifications
// ============================================================================

export type NotificationKind = 'comment' | 'mention' | 'request' | 'meeting_notes';

export interface NotificationDTO {
  id: string;
  kind: NotificationKind;
  /** One line, e.g. "Priya mentioned you on ENG-12 Fix login". */
  title: string;
  /** A short excerpt of what happened. */
  body: string;
  /** Where clicking it goes, inside the app. */
  href: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListDTO {
  notifications: NotificationDTO[];
  unreadCount: number;
}

export const MarkNotificationsReadSchema = z.object({
  /** Marks these as read, or every notification when omitted. */
  ids: z.array(z.string().uuid()).max(100).optional(),
});
