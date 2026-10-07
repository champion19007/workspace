import crypto from 'node:crypto';
import type { Sql } from 'postgres';
import {
  generateUuidV7,
  NotFoundError,
  type LLMPort,
} from '@workspace/core';

export const PII_MASKING_POLICY_VERSION = 'v1.0.0';
export const DEFAULT_EMBEDDING_SPACE = 'voyage-3-lite';
export const TASK_DEDUP_SIMILARITY_THRESHOLD = 0.85;

/**
 * Versioned PII-masking policy for task and meeting embeddings (v1.0.0).
 * Redacts email addresses, phone numbers, IP addresses, and sensitive tokens
 * before embedding to protect user privacy across shared embedding vector spaces.
 */
export function maskPiiForEmbedding(text: string): string {
  if (!text) return '';
  return text
    // 1. Redact emails
    .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[EMAIL]')
    // 2. Redact international & domestic phone numbers
    .replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE]')
    // 3. Redact IPv4 addresses
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP_ADDRESS]')
    // 4. Redact potential access tokens / secrets (hex or base64 strings of >= 32 chars)
    .replace(/\b(?:ghp_[a-zA-Z0-9]{36}|xox[baprs]-[a-zA-Z0-9-]{10,48}|[a-f0-9]{32,64})\b/g, '[SECRET]')
    // 5. Redact URLs
    .replace(/https?:\/\/[^\s]+/g, '[URL]');
}

/**
 * Computes deterministic SHA-256 content hash of masked title + description.
 * Changes to task ranks, assignees, due dates, or status do not alter the content hash,
 * preventing unnecessary embedding recalculation.
 */
export function computeTaskContentHash(title: string, description?: string | null): string {
  const maskedTitle = maskPiiForEmbedding(title || '');
  const maskedDesc = maskPiiForEmbedding(description || '');
  const payload = `${maskedTitle}\n${maskedDesc}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export interface IndexTaskEmbeddingParams {
  orgId: string;
  taskId: string;
  embeddingSpace?: string;
  force?: boolean;
}

export interface IndexTaskEmbeddingResult {
  indexed: boolean;
  contentHash: string;
  embeddingSpace: string;
}

/**
 * Indexes a single task's embedding into task_embeddings.
 * Idempotently skips indexing if the content_hash has not changed.
 * CRITICAL INVARIANT: This function does NOT mutate tasks table rows or bump task versions.
 */
export async function indexTaskEmbedding(
  sql: Sql,
  llmPort: LLMPort,
  params: IndexTaskEmbeddingParams
): Promise<IndexTaskEmbeddingResult> {
  const { orgId, taskId, embeddingSpace = DEFAULT_EMBEDDING_SPACE, force = false } = params;

  // 1. Fetch task details
  const [task] = await sql<Array<{
    id: string;
    org_id: string;
    project_id: string;
    title: string;
    description: string | null;
    status: string;
    archived_at: Date | null;
  }>>`
    SELECT id, org_id, project_id, title, description, status, archived_at
    FROM tasks
    WHERE org_id = ${orgId} AND id = ${taskId}
    LIMIT 1
  `;

  if (!task || task.archived_at !== null) {
    throw new NotFoundError(`Task ${taskId} not found or archived`);
  }

  const contentHash = computeTaskContentHash(task.title, task.description);

  // 2. Check if already cached with matching hash and policy version
  if (!force) {
    const [existing] = await sql<Array<{ id: string }>>`
      SELECT id FROM task_embeddings
      WHERE org_id = ${orgId}
        AND task_id = ${taskId}
        AND embedding_space = ${embeddingSpace}
        AND policy_version = ${PII_MASKING_POLICY_VERSION}
        AND content_hash = ${contentHash}
      LIMIT 1
    `;

    if (existing) {
      return {
        indexed: false,
        contentHash,
        embeddingSpace,
      };
    }
  }

  // 3. Compute vector embedding on masked content
  const textToEmbed = `${maskPiiForEmbedding(task.title)}\n${maskPiiForEmbedding(task.description || '')}`.trim();
  const embedResult = await llmPort.embed({ texts: [textToEmbed] });

  const vector = embedResult.embeddings[0];
  if (!vector || vector.length !== 1024) {
    throw new Error(`Embedding model produced invalid dimensions: expected 1024, received ${vector?.length ?? 'none'}`);
  }

  // Validate finite floats and non-zero
  if (!vector.every((v) => Number.isFinite(v))) {
    throw new Error('Generated task embedding vector contains non-finite float values');
  }
  if (!vector.some((v) => v !== 0)) {
    throw new Error('Generated task embedding vector is all zeros');
  }

  // 4. Persist to task_embeddings without mutating tasks table
  await sql`
    INSERT INTO task_embeddings (
      id,
      org_id,
      task_id,
      content_hash,
      embedding_space,
      policy_version,
      embedding,
      created_at,
      updated_at
    ) VALUES (
      ${generateUuidV7()},
      ${orgId},
      ${taskId},
      ${contentHash},
      ${embeddingSpace},
      ${PII_MASKING_POLICY_VERSION},
      ${JSON.stringify(vector)}::vector,
      now(),
      now()
    )
    ON CONFLICT (task_id, embedding_space, policy_version) DO UPDATE SET
      content_hash = EXCLUDED.content_hash,
      embedding = EXCLUDED.embedding,
      updated_at = now()
  `;

  return {
    indexed: true,
    contentHash,
    embeddingSpace,
  };
}

/**
 * Ensures all active open tasks in a project have current embeddings.
 * Backfills missing or outdated task embeddings for deduplication searches.
 */
export async function ensureProjectTaskEmbeddings(
  sql: Sql,
  llmPort: LLMPort,
  params: {
    orgId: string;
    nodeId: string;
    embeddingSpace?: string;
  }
): Promise<{ total: number; indexed: number }> {
  const { orgId, nodeId, embeddingSpace = DEFAULT_EMBEDDING_SPACE } = params;

  // Open tasks only: todo, in_progress, blocked
  const openTasks = await sql<Array<{
    id: string;
    title: string;
    description: string | null;
  }>>`
    SELECT id, title, description
    FROM tasks
    WHERE org_id = ${orgId}
      AND project_id = ${nodeId}
      AND status IN ('todo', 'in_progress', 'blocked')
      AND archived_at IS NULL
  `;

  let indexedCount = 0;
  for (const t of openTasks) {
    const res = await indexTaskEmbedding(sql, llmPort, {
      orgId,
      taskId: t.id,
      embeddingSpace,
    });
    if (res.indexed) {
      indexedCount++;
    }
  }

  return {
    total: openTasks.length,
    indexed: indexedCount,
  };
}

export interface MatchingTaskCandidate {
  taskId: string;
  key: string;
  title: string;
  status: string;
  version: number;
  contentHash: string;
  similarityScore: number;
}

/**
 * Performs exact vector similarity search scoped strictly to the specified project.
 * Excludes completed tasks ('done'), archived tasks, and inactive/other projects.
 * Includes eligible open subtasks with parent task context.
 */
export async function findMatchingOpenTasks(
  sql: any,
  params: {
    orgId: string;
    nodeId: string;
    queryVector: number[];
    embeddingSpace?: string;
    minSimilarity?: number;
    limit?: number;
  }
): Promise<MatchingTaskCandidate[]> {
  const {
    orgId,
    nodeId,
    queryVector,
    embeddingSpace = DEFAULT_EMBEDDING_SPACE,
    minSimilarity = 0.50,
    limit = 5,
  } = params;

  if (!queryVector || queryVector.length !== 1024) {
    throw new Error('Query vector must have exactly 1024 dimensions');
  }

  interface SimilarityRow {
    task_id: string;
    key: string;
    title: string;
    status: string;
    version: number;
    content_hash: string;
    similarity: number;
  }

  // Exact cosine similarity search: 1 - cosine_distance
  const rows: SimilarityRow[] = await sql`
    SELECT
      t.id AS task_id,
      t.key,
      t.title,
      t.status,
      t.version,
      te.content_hash,
      (1.0 - (te.embedding <=> ${JSON.stringify(queryVector)}::vector))::float8 AS similarity
    FROM tasks t
    JOIN task_embeddings te ON te.task_id = t.id AND te.org_id = t.org_id
    WHERE t.org_id = ${orgId}
      AND t.project_id = ${nodeId}
      AND t.status IN ('todo', 'in_progress', 'blocked')
      AND t.archived_at IS NULL
      AND te.embedding_space = ${embeddingSpace}
      AND te.policy_version = ${PII_MASKING_POLICY_VERSION}
    ORDER BY te.embedding <=> ${JSON.stringify(queryVector)}::vector ASC
    LIMIT ${limit}
  `;

  return rows
    .filter((r: SimilarityRow) => r.similarity >= minSimilarity)
    .map((r: SimilarityRow) => ({
      taskId: r.task_id,
      key: r.key,
      title: r.title,
      status: r.status,
      version: Number(r.version),
      contentHash: r.content_hash,
      similarityScore: Math.round(Number(r.similarity) * 10000) / 10000,
    }));
}
