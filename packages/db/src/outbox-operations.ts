import postgres from 'postgres';
import { loginSql, tenantSql, withTenantContext, type DatabaseInstance, type TenantTransaction } from './client.js';
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
    const sql = tenantSql(db as postgres.Sql, { orgId: params.orgId });
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

  const [record] = await withTenantContext(db as DatabaseInstance, { orgId: params.orgId }, (tx) =>
    tx
      .insert(outbox)
      .values({
        orgId: params.orgId,
        topic: params.topic,
        payload: params.payload,
      })
      .returning({ id: outbox.id })
  );

  if (!record) {
    throw new Error('Failed to insert outbox event');
  }

  return record.id;
}

// The relay works across organizations through the narrowly privileged entry points of migration 0015.

export async function claimOutboxBatch(
  sql: postgres.Sql,
  params: {
    workerId: string;
    batchSize?: number;
    leaseSeconds?: number;
  }
): Promise<OutboxRecord[]> {
  const { workerId, batchSize = 50, leaseSeconds = 60 } = params;

  // Atomic SELECT ... FOR UPDATE SKIP LOCKED + lease update inside sys_outbox_claim
  return loginSql(sql)<OutboxRecord[]>`
    SELECT
      id,
      org_id as "orgId",
      topic,
      payload,
      delivery_attempts as "deliveryAttempts",
      locked_at as "lockedAt",
      locked_by as "lockedBy",
      last_error as "lastError",
      sent_at as "sentAt",
      created_at as "createdAt"
    FROM sys_outbox_claim(${workerId}, ${batchSize}, ${leaseSeconds})
  `;
}

export async function markOutboxDelivered(
  sql: postgres.Sql,
  params: {
    id: string;
    workerId: string;
  }
): Promise<boolean> {
  const [row] = await loginSql(sql)<Array<{ ok: boolean }>>`
    SELECT sys_outbox_mark_delivered(${params.id}, ${params.workerId}) AS ok
  `;
  return row!.ok;
}

export async function recordOutboxFailure(
  sql: postgres.Sql,
  params: {
    id: string;
    workerId: string;
    error: string;
  }
): Promise<boolean> {
  const [row] = await loginSql(sql)<Array<{ ok: boolean }>>`
    SELECT sys_outbox_record_failure(${params.id}, ${params.workerId}, ${params.error}) AS ok
  `;
  return row!.ok;
}

export async function purgeDeliveredOutboxRecords(
  sql: postgres.Sql,
  params: {
    retentionDays?: number;
  } = {}
): Promise<number> {
  const { retentionDays = 7 } = params;
  const [row] = await loginSql(sql)<Array<{ purged: number }>>`
    SELECT sys_outbox_purge(${retentionDays}) AS purged
  `;
  return row!.purged;
}
