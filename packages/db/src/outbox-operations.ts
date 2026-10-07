import postgres from 'postgres';
import { type DatabaseInstance, type TenantTransaction } from './client.js';
import { outbox } from './schema/index.js';

export interface OutboxRecord {
  id: string;
  orgId: string;
  topic: string;
  payload: Record<string, unknown>;
  deliveryAttempts: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface InsertOutboxEventParams {
  orgId: string;
  topic: string;
  payload: Record<string, unknown>;
}

export async function insertOutboxEvent(
  db: DatabaseInstance | TenantTransaction | postgres.Sql | postgres.TransactionSql,
  params: InsertOutboxEventParams
): Promise<string> {
  if (typeof db === 'function') {
    const sql = db as postgres.Sql;
    const [record] = await sql`
      INSERT INTO outbox (id, org_id, topic, payload)
      VALUES (uuid_generate_v7(), ${params.orgId}, ${params.topic}, ${JSON.stringify(params.payload)}::jsonb)
      RETURNING id
    `;
    if (!record) {
      throw new Error('Failed to insert outbox event');
    }
    return record.id;
  }

  const [record] = await db
    .insert(outbox)
    .values({
      orgId: params.orgId,
      topic: params.topic,
      payload: params.payload,
    })
    .returning({ id: outbox.id });

  if (!record) {
    throw new Error('Failed to insert outbox event');
  }

  return record.id;
}

export async function claimOutboxBatch(
  sql: postgres.Sql,
  params: {
    workerId: string;
    batchSize?: number;
    leaseSeconds?: number;
  }
): Promise<OutboxRecord[]> {
  const { workerId, batchSize = 50, leaseSeconds = 60 } = params;

  // Use raw sql transaction to perform atomic SELECT ... FOR UPDATE SKIP LOCKED and update
  return sql.begin(async (txn) => {
    const rows = await txn<OutboxRecord[]>`
      WITH claimable AS (
        SELECT id
        FROM outbox
        WHERE sent_at IS NULL
          AND (locked_at IS NULL OR locked_at < NOW() - (${leaseSeconds} || ' seconds')::interval)
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox
      SET locked_at = NOW(),
          locked_by = ${workerId},
          delivery_attempts = delivery_attempts + 1
      FROM claimable
      WHERE outbox.id = claimable.id
      RETURNING 
        outbox.id,
        outbox.org_id as "orgId",
        outbox.topic,
        outbox.payload,
        outbox.delivery_attempts as "deliveryAttempts",
        outbox.locked_at as "lockedAt",
        outbox.locked_by as "lockedBy",
        outbox.last_error as "lastError",
        outbox.sent_at as "sentAt",
        outbox.created_at as "createdAt"
    `;

    return rows;
  });
}

export async function markOutboxDelivered(
  sql: postgres.Sql,
  params: {
    id: string;
    workerId: string;
  }
): Promise<boolean> {
  const result = await sql`
    UPDATE outbox
    SET sent_at = NOW(),
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL
    WHERE id = ${params.id}
      AND locked_by = ${params.workerId}
  `;
  return result.count > 0;
}

export async function recordOutboxFailure(
  sql: postgres.Sql,
  params: {
    id: string;
    workerId: string;
    error: string;
  }
): Promise<boolean> {
  const result = await sql`
    UPDATE outbox
    SET locked_at = NULL,
        locked_by = NULL,
        last_error = ${params.error}
    WHERE id = ${params.id}
      AND locked_by = ${params.workerId}
  `;
  return result.count > 0;
}

export async function purgeDeliveredOutboxRecords(
  sql: postgres.Sql,
  params: {
    retentionDays?: number;
  } = {}
): Promise<number> {
  const { retentionDays = 7 } = params;
  const result = await sql`
    DELETE FROM outbox
    WHERE sent_at IS NOT NULL
      AND sent_at < NOW() - (${retentionDays} || ' days')::interval
  `;
  return result.count;
}
