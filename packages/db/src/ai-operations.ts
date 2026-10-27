import { createHash } from 'node:crypto';
import { NotFoundError, type ProgressSummaryDTO } from '@workspace/core';
import { tenantSql, type DbOrSql, type TenantContext } from './client.js';

const scoped = (db: DbOrSql, context: TenantContext): any => tenantSql(db, context);

/** The signed-in person the query runs as. */
type Caller = { orgId: string; userId: string; role: string };

/** The words of a question as an any-word full-text query ("invoice | late"), or null when it has none. */
export function questionToTsQuery(question: string): string | null {
  const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 12);
  return words.length > 0 ? words.join(' | ') : null;
}

export interface TaskMatch {
  id: string;
  key: string;
  title: string;
  status: string;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  assignee: string | null;
  description: string;
}

export interface DocMatch {
  id: string;
  title: string;
  nodeId: string;
  nodeKind: 'team' | 'project';
  nodeName: string;
  excerpt: string;
}

/** Tasks and docs whose words match a question, among those the caller can see (RLS), best match first. */
export async function searchWorkspace(
  db: DbOrSql,
  params: Caller & { question: string }
): Promise<{ tasks: TaskMatch[]; docs: DocMatch[] }> {
  const query = questionToTsQuery(params.question);
  if (!query) return { tasks: [], docs: [] };
  const sql = scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role });
  const [tasks, docs] = await Promise.all([
    sql`
      SELECT t.id, t.key, t.title, t.status, TO_CHAR(t.due_date, 'YYYY-MM-DD') AS due_date, t.project_id,
             n.name AS project_name, left(coalesce(t.description, ''), 300) AS description,
             COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) AS assignee
      FROM tasks t
      JOIN nodes n ON n.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.org_id = ${params.orgId} AND t.archived_at IS NULL
        AND to_tsvector('english', t.title || ' ' || coalesce(t.description, '')) @@ to_tsquery('english', ${query})
      ORDER BY ts_rank(to_tsvector('english', t.title || ' ' || coalesce(t.description, '')), to_tsquery('english', ${query})) DESC
      LIMIT 10
    `,
    sql`
      SELECT d.id, d.title, d.node_id, n.kind AS node_kind, n.name AS node_name,
             ts_headline('english', d.body_md, to_tsquery('english', ${query}),
                         'StartSel="", StopSel="", MaxWords=50, MinWords=15, MaxFragments=2') AS excerpt
      FROM docs d
      JOIN nodes n ON n.id = d.node_id
      WHERE d.org_id = ${params.orgId} AND d.archived_at IS NULL
        AND to_tsvector('english', d.title || ' ' || d.body_md) @@ to_tsquery('english', ${query})
      ORDER BY ts_rank(to_tsvector('english', d.title || ' ' || d.body_md), to_tsquery('english', ${query})) DESC
      LIMIT 6
    `,
  ]);
  return {
    tasks: tasks.map((r: any) => ({
      id: r.id,
      key: r.key,
      title: r.title,
      status: r.status,
      dueDate: r.due_date,
      projectId: r.project_id,
      projectName: r.project_name,
      assignee: r.assignee,
      description: r.description,
    })),
    docs: docs.map((r: any) => ({
      id: r.id,
      title: r.title,
      nodeId: r.node_id,
      nodeKind: r.node_kind,
      nodeName: r.node_name,
      excerpt: r.excerpt,
    })),
  };
}

/** A project's name, if the caller can see it. */
export async function getVisibleProjectName(db: DbOrSql, params: Caller & { projectId: string }): Promise<string> {
  const [row] = await scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role })`
    SELECT name FROM nodes
    WHERE org_id = ${params.orgId} AND id = ${params.projectId} AND kind = 'project' AND archived_at IS NULL
  `;
  if (!row) throw new NotFoundError('Project not found');
  return row.name;
}

/** Tasks finished in the last week in projects the caller can see, newest first. */
export async function listRecentlyDoneTasks(
  db: DbOrSql,
  params: Caller
): Promise<Array<{ projectId: string; title: string }>> {
  const rows = await scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role })`
    SELECT project_id, title FROM tasks
    WHERE org_id = ${params.orgId} AND archived_at IS NULL AND status = 'done' AND updated_at > NOW() - INTERVAL '7 days'
    ORDER BY updated_at DESC
    LIMIT 40
  `;
  return rows.map((r: any) => ({ projectId: r.project_id, title: r.title }));
}

/** Which projects a summary was written from: a summary is reused only for the same set. */
export function progressScopeKey(projectIds: string[]): string {
  return createHash('sha256').update([...projectIds].sort().join(',')).digest('hex');
}

type SummaryBody = Omit<ProgressSummaryDTO, 'createdAt'>;

/** The caller's latest summary for this set of projects, if it is younger than `maxAgeMinutes`. */
export async function getProgressSummary(
  db: DbOrSql,
  params: Caller & { scopeKey: string; maxAgeMinutes: number }
): Promise<ProgressSummaryDTO | null> {
  const [row] = await scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role })`
    SELECT body, created_at FROM progress_summaries
    WHERE org_id = ${params.orgId} AND user_id = ${params.userId} AND scope_key = ${params.scopeKey}
      AND created_at > NOW() - make_interval(mins => ${params.maxAgeMinutes})
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return row ? { ...(row.body as SummaryBody), createdAt: new Date(row.created_at).toISOString() } : null;
}

/** Keeps a new summary for the caller and drops their summaries older than a day. */
export async function saveProgressSummary(
  db: DbOrSql,
  params: Caller & { scopeKey: string; body: SummaryBody }
): Promise<ProgressSummaryDTO> {
  return scoped(db, { orgId: params.orgId, userId: params.userId, role: params.role }).begin(async (sql: any) => {
    await sql`
      DELETE FROM progress_summaries
      WHERE org_id = ${params.orgId} AND user_id = ${params.userId} AND created_at < NOW() - INTERVAL '1 day'
    `;
    const [row] = await sql`
      INSERT INTO progress_summaries (org_id, user_id, scope_key, body)
      VALUES (${params.orgId}, ${params.userId}, ${params.scopeKey}, ${JSON.stringify(params.body)}::jsonb)
      RETURNING created_at
    `;
    return { ...params.body, createdAt: new Date(row.created_at).toISOString() };
  });
}
