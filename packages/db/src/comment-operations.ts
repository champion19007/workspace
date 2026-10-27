import {
  ForbiddenError,
  NotFoundError,
  commentRecipients,
  extractMarkdownExcerpt,
  generateUuidV7,
  type CommentDTO,
  type CommentTargetType,
  type CreateCommentInput,
  type NotificationKind,
  type NotificationListDTO,
  type PersonDTO,
} from '@workspace/core';
import { tenantSql, type DbOrSql, type TenantContext } from './client.js';

const scoped = (db: DbOrSql, context: TenantContext): any => tenantSql(db, context);

interface CommentTarget {
  /** The project or team whose visibility decides who may see the comment. */
  nodeId: string;
  /** How notifications name it, e.g. "ENG-12 Fix login". */
  label: string;
  href: string;
  assigneeId: string | null;
  creatorId: string | null;
}

/** What a comment is about, as the caller sees it. Anything they can't see is "not found". */
async function loadTarget(
  sql: any,
  orgId: string,
  role: string,
  targetType: CommentTargetType,
  targetId: string
): Promise<CommentTarget> {
  // Task comments are the team's working notes: clients never see them, even on a task they can see.
  if (targetType === 'task' && role !== 'client') {
    const [t] = await sql`
      SELECT id, key, title, project_id, assignee_id, created_by FROM tasks
      WHERE org_id = ${orgId} AND id = ${targetId} AND archived_at IS NULL
    `;
    if (t) {
      return {
        nodeId: t.project_id,
        label: `${t.key} ${t.title}`,
        href: `/orgs/${orgId}/projects/${t.project_id}/tasks?task=${t.id}`,
        assigneeId: t.assignee_id,
        creatorId: t.created_by,
      };
    }
  } else if (targetType === 'doc') {
    const [d] = await sql`
      SELECT d.id, d.title, d.node_id, d.created_by, n.kind FROM docs d JOIN nodes n ON n.id = d.node_id
      WHERE d.org_id = ${orgId} AND d.id = ${targetId} AND d.archived_at IS NULL
    `;
    if (d) {
      return {
        nodeId: d.node_id,
        label: d.title,
        href: d.kind === 'project' ? `/orgs/${orgId}/projects/${d.node_id}/docs/${d.id}` : `/orgs/${orgId}/docs/${d.id}`,
        assigneeId: null,
        creatorId: d.created_by,
      };
    }
  } else if (targetType === 'node') {
    const [n] = await sql`
      SELECT id, name, created_by FROM nodes
      WHERE org_id = ${orgId} AND id = ${targetId} AND kind = 'project' AND archived_at IS NULL
    `;
    if (n) {
      return {
        nodeId: n.id,
        label: n.name,
        href: `/orgs/${orgId}/projects/${n.id}/dashboard#discussion`,
        assigneeId: null,
        creatorId: n.created_by,
      };
    }
  }
  throw new NotFoundError('This item does not exist or you do not have access to it');
}

/**
 * The members who can see `nodeId`: Owners and Managers, everyone but clients when it is public, and anyone added
 * to it. Limited to `candidateIds` when given.
 */
async function membersWhoCanSee(
  sql: any,
  orgId: string,
  nodeId: string,
  opts: { candidateIds?: string[]; excludeClients: boolean }
): Promise<PersonDTO[]> {
  const candidates = opts.candidateIds ?? null;
  const rows = await sql`
    SELECT u.id, COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) AS name
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    JOIN nodes n ON n.id = ${nodeId} AND n.org_id = m.org_id
    WHERE m.org_id = ${orgId}
      AND (${candidates}::uuid[] IS NULL OR m.user_id = ANY(${candidates}::uuid[]))
      AND (NOT ${opts.excludeClients} OR m.role <> 'client')
      AND (
        m.role IN ('owner', 'admin')
        OR (n.visibility = 'public' AND m.role <> 'client')
        OR EXISTS (SELECT 1 FROM node_members nm WHERE nm.node_id = n.id AND nm.user_id = m.user_id)
      )
    ORDER BY name
  `;
  return rows.map((r: any) => ({ id: r.id, name: r.name }));
}

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  /** One notification per person and key; repeats are ignored. */
  dedupeKey: string;
  title: string;
  body: string;
  href: string;
}

/** Records notifications for other people, inside the caller's tenant transaction. */
export async function insertNotifications(sql: any, orgId: string, items: NewNotification[]): Promise<void> {
  for (const n of items) {
    // No RETURNING and no ON CONFLICT: under RLS both need read access to the row, which only its recipient has.
    const insert = (q: any) => q`
      INSERT INTO notifications (id, org_id, user_id, kind, payload, dedupe_key)
      VALUES (
        ${generateUuidV7()}, ${orgId}, ${n.userId}, ${n.kind},
        ${JSON.stringify({ title: n.title, body: n.body, href: n.href })}::jsonb, ${n.dedupeKey}
      )
    `;
    try {
      await (typeof sql.savepoint === 'function' ? sql.savepoint(insert) : insert(sql));
    } catch (err) {
      // They already have this one (unique org, user, dedupe key).
      if ((err as { code?: string }).code !== '23505') throw err;
    }
  }
}

async function namesOf(sql: any, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await sql`
    SELECT id, COALESCE(NULLIF(name, ''), split_part(email, '@', 1)) AS name FROM users WHERE id = ANY(${ids}::uuid[])
  `;
  return new Map(rows.map((r: any) => [r.id, r.name]));
}

export async function listComments(
  db: DbOrSql,
  params: { orgId: string; userId: string; role: string; targetType: CommentTargetType; targetId: string }
): Promise<CommentDTO[]> {
  const { orgId, userId, role, targetType, targetId } = params;
  return scoped(db, { orgId, userId, role }).begin(async (sql: any) => {
    await loadTarget(sql, orgId, role, targetType, targetId);
    const rows = await sql`
      SELECT c.id, c.author_id, c.body_md, c.mentions, c.created_at,
             COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1), 'Former member') AS author_name
      FROM comments c
      LEFT JOIN users u ON u.id = c.author_id
      WHERE c.org_id = ${orgId} AND c.target_type = ${targetType} AND c.target_id = ${targetId} AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT 500
    `;
    const names = await namesOf(sql, [...new Set<string>(rows.flatMap((r: any) => r.mentions as string[]))]);
    const canModerate = role === 'owner' || role === 'admin';
    return rows.map((r: any) => ({
      id: r.id,
      targetType,
      targetId,
      author: { id: r.author_id, name: r.author_name },
      bodyMd: r.body_md,
      mentions: (r.mentions as string[]).filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
      createdAt: new Date(r.created_at).toISOString(),
      canDelete: r.author_id === userId || canModerate,
    }));
  });
}

/** The people a comment can @mention: those who will be able to read it. */
export async function listMentionableUsers(
  db: DbOrSql,
  params: { orgId: string; userId: string; role: string; targetType: CommentTargetType; targetId: string }
): Promise<PersonDTO[]> {
  const { orgId, userId, role, targetType, targetId } = params;
  return scoped(db, { orgId, userId, role }).begin(async (sql: any) => {
    const target = await loadTarget(sql, orgId, role, targetType, targetId);
    // Clients can mention the team, but never learn who the organization's other clients are.
    const people = await membersWhoCanSee(sql, orgId, target.nodeId, {
      excludeClients: targetType === 'task' || role === 'client',
    });
    return people.filter((p) => p.id !== userId);
  });
}

/** Everyone, Executives and Clients included, can comment on what they can see. */
export async function createComment(
  db: DbOrSql,
  params: { orgId: string; actorUserId: string; role: string; input: CreateCommentInput }
): Promise<CommentDTO> {
  const { orgId, actorUserId, role, input } = params;
  return scoped(db, { orgId, userId: actorUserId, role }).begin(async (sql: any) => {
    const target = await loadTarget(sql, orgId, role, input.targetType, input.targetId);
    const excludeClients = input.targetType === 'task' || role === 'client';
    const mentioned = input.mentions.length
      ? await membersWhoCanSee(sql, orgId, target.nodeId, { candidateIds: [...new Set(input.mentions)], excludeClients })
      : [];

    const id = generateUuidV7();
    const bodyMd = input.bodyMd.trim();
    const [row] = await sql`
      INSERT INTO comments (id, org_id, target_type, target_id, author_id, body_md, mentions)
      VALUES (
        ${id}, ${orgId}, ${input.targetType}, ${input.targetId}, ${actorUserId}, ${bodyMd},
        ${JSON.stringify(mentioned.map((m) => m.id))}::jsonb
      )
      RETURNING created_at
    `;
    const authorName = (await namesOf(sql, [actorUserId])).get(actorUserId) ?? 'Someone';

    const earlier = await sql`
      SELECT author_id FROM comments
      WHERE org_id = ${orgId} AND target_type = ${input.targetType} AND target_id = ${input.targetId}
        AND deleted_at IS NULL AND id <> ${id}
      GROUP BY author_id
      ORDER BY MIN(created_at)
    `;
    const wanted = commentRecipients({
      authorId: actorUserId,
      mentionedIds: mentioned.map((m) => m.id),
      earlierCommenterIds: earlier.map((r: any) => r.author_id),
      assigneeId: target.assigneeId,
      creatorId: target.creatorId,
    });
    const recipients = wanted.length
      ? await membersWhoCanSee(sql, orgId, target.nodeId, {
          candidateIds: [...new Set(wanted)],
          excludeClients: input.targetType === 'task',
        })
      : [];
    const mentionedIds = new Set(mentioned.map((m) => m.id));
    await insertNotifications(
      sql,
      orgId,
      recipients.map((r) => ({
        userId: r.id,
        kind: mentionedIds.has(r.id) ? 'mention' : 'comment',
        dedupeKey: `comment:${id}`,
        title: `${authorName} ${mentionedIds.has(r.id) ? 'mentioned you on' : 'commented on'} ${target.label}`,
        body: extractMarkdownExcerpt(bodyMd, 140),
        href: target.href,
      }))
    );

    return {
      id,
      targetType: input.targetType,
      targetId: input.targetId,
      author: { id: actorUserId, name: authorName },
      bodyMd,
      mentions: mentioned,
      createdAt: new Date(row.created_at).toISOString(),
      canDelete: true,
    };
  });
}

/** Authors can delete their own comments; Owners and Managers can delete any. */
export async function deleteComment(
  db: DbOrSql,
  params: { orgId: string; actorUserId: string; role: string; commentId: string }
): Promise<void> {
  const { orgId, actorUserId, role, commentId } = params;
  await scoped(db, { orgId, userId: actorUserId, role }).begin(async (sql: any) => {
    const [c] = await sql`
      SELECT author_id FROM comments WHERE org_id = ${orgId} AND id = ${commentId} AND deleted_at IS NULL
    `;
    if (!c) throw new NotFoundError('Comment not found');
    if (c.author_id !== actorUserId && role !== 'owner' && role !== 'admin') {
      throw new ForbiddenError('You can only delete your own comments');
    }
    await sql`UPDATE comments SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${commentId}`;
  });
}

export async function listNotifications(
  db: DbOrSql,
  params: { orgId: string; userId: string; role: string; limit?: number }
): Promise<NotificationListDTO> {
  const { orgId, userId, role } = params;
  return scoped(db, { orgId, userId, role }).begin(async (sql: any) => {
    const rows = await sql`
      SELECT id, kind, payload, read_at, created_at FROM notifications
      WHERE org_id = ${orgId} AND user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${params.limit ?? 30}
    `;
    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM notifications
      WHERE org_id = ${orgId} AND user_id = ${userId} AND read_at IS NULL
    `;
    return {
      notifications: rows.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        title: r.payload?.title ?? '',
        body: r.payload?.body ?? '',
        href: r.payload?.href ?? `/orgs/${orgId}`,
        readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      unreadCount: count,
    };
  });
}

/** Marks the given notifications as read, or all of them when `ids` is omitted. */
export async function markNotificationsRead(
  db: DbOrSql,
  params: { orgId: string; userId: string; role: string; ids?: string[] }
): Promise<void> {
  const { orgId, userId, role, ids } = params;
  const sql = scoped(db, { orgId, userId, role });
  await sql`
    UPDATE notifications SET read_at = NOW()
    WHERE org_id = ${orgId} AND user_id = ${userId} AND read_at IS NULL
      ${ids ? sql`AND id = ANY(${ids}::uuid[])` : sql``}
  `;
}
