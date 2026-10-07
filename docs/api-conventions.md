# Workspace v1 — Shared API Conventions, Outbox & Background Infrastructure

## Overview
This document defines the REST API standards, background-job infrastructure, Architecture A adapter contracts, transactional outbox pattern, optimistic concurrency control (OCC), idempotency, and rate limiting implemented in **Stage 5** of Workspace v1.

---

## 1. REST API Request Pipeline

All organization-scoped REST endpoints follow the prefix `/api/v1/orgs/{orgSlug}/...` (or `/api/v1/orgs/{orgId}/...`).

The Fastify pipeline enforces a strict 9-step execution sequence:
```
[1. Verify Authentication]
        │
[2. Resolve Application User]
        │
[3. Resolve Organization from Path]
        │
[4. Verify Membership & Role]
        │
[5. Validate Input Schema (Zod / JSON Schema)]
        │
[6. Establish Transaction-Local Tenant Context (withTenantContext)]
        │
[7. Apply Resource-Level Permissions]
        │
[8. Execute Domain Operation]
        │
[9. Return Validated Response & Headers (ETag, x-request-id)]
```

### Security Invariants:
- Never trust a client-supplied `org_id` in request bodies or query parameters. The organization is exclusively resolved from the validated URL path and verified against database memberships.
- Never trust browser-supplied user IDs. Actor identity is derived strictly from the server-validated authentication token or HMAC-signed BFF session headers.

---

## 2. RFC 9457 Problem Details (`application/problem+json`)

All HTTP errors return the standard RFC 9457 Problem Details format:
```json
{
  "type": "https://api.workspace.dev/errors/validation-error",
  "title": "Validation Failed",
  "status": 422,
  "detail": "The request payload or parameters failed validation",
  "code": "VALIDATION_ERROR",
  "instance": "/api/v1/orgs/018f.../invitations",
  "invalidParams": [
    {
      "name": "email",
      "reason": "Invalid email format"
    }
  ]
}
```

### Standard Error Codes & HTTP Mappings:
| HTTP Status | Error Type / Name | Application Code | Description |
|---|---|---|---|
| **400** | Bad Request | `BAD_REQUEST` | Syntax or protocol violation, invalid JSON, or invalid cursor |
| **401** | Unauthorized | `UNAUTHORIZED` | Missing, expired, forged, or unauthenticated session token |
| **403** | Forbidden | `FORBIDDEN` | Valid authentication but caller lacks necessary organization role or permissions |
| **404** | Not Found | `NOT_FOUND` | Target organization, member, task, or resource does not exist |
| **409** | Conflict | `CONFLICT` / `IDEMPOTENCY_IN_FLIGHT` | State conflict or concurrent request in-flight with same idempotency key |
| **412** | Precondition Failed | `PRECONDITION_FAILED` | Concurrency check failed: `If-Match` ETag mismatch against current entity version |
| **422** | Unprocessable Content | `VALIDATION_ERROR` | Schema validation error, semantic rule breach, or idempotency payload mismatch |
| **429** | Too Many Requests | `RATE_LIMIT_EXCEEDED` | Request limit exceeded; carries `Retry-After` header |
| **500** | Internal Server Error | `INTERNAL_ERROR` | Unexpected server failure; sensitive stack traces and database errors omitted |

---

## 3. Optimistic Concurrency Control (OCC)

To prevent lost updates on concurrent mutations (such as tasks, documents, and node trees), OCC uses standard HTTP `ETag` and `If-Match` headers:

1. **Entity Versioning**: Every mutable entity carries an integer `version` incremented atomically on every update.
2. **ETag Generation**: GET requests return weak ETags: `ETag: W/"v<version>"`.
3. **Conditional Mutation**: Mutating endpoints (`PATCH`, `PUT`, `DELETE`) require `If-Match: W/"v<version>"` or `If-Match: "<version>"`.
4. **Precondition Enforcement**:
   - If `If-Match` is omitted or does not match the current entity version in PostgreSQL, the API halts before mutating and returns `412 Precondition Failed`.
   - The RFC 9457 error body includes `currentEntity` in the details, enabling clients to immediately display the current state and offer merge options to the user.
5. **Atomic Version Increment**: SQL updates atomically increment the version:
   ```sql
   UPDATE tasks
   SET title = $1, version = version + 1, updated_at = NOW()
   WHERE id = $2 AND org_id = $3 AND version = $4
   RETURNING *;
   ```

---

## 4. PostgreSQL-Backed Idempotency

Mutating POST endpoints accept the `Idempotency-Key` header (e.g., UUIDv7 or client-generated token up to 128 chars):

### Database Schema (`idempotency_keys`):
- Scoped to `(org_id, actor_id, key)` compound unique index.
- Stores request fingerprint: SHA-256 hash of `METHOD:URL:JSON_BODY`.
- Statuses: `pending`, `completed`, `failed`.
- 24-hour expiration (`expires_at`), after which keys are automatically eligible for purge.

### Invariant & Race Handling:
1. **First Execution**: Inserts row with `status = 'pending'`. The domain operation proceeds normally. Upon completion, `onSend` updates the row to `status = 'completed'` with the status code and cached response body.
2. **Concurrent Request (In-Flight)**: If a duplicate request arrives while the first is still processing (`status = 'pending'`), the API returns `409 Conflict` with `IDEMPOTENCY_IN_FLIGHT`.
3. **Fingerprint Mismatch**: If the same key is reused with a different payload or endpoint, the API returns `422 Unprocessable Content` with `VALIDATION_ERROR`.
4. **Replay with Permission Re-verification**: When replaying a completed request, the API **re-evaluates** the caller's organization membership and role before returning the cached response. Revoked users receive `403 Forbidden` and cannot retrieve previously executed data.

---

## 5. Cursor Pagination & `updatedSince`

### Query Contract:
- `limit`: Integer between 1 and 100 (defaults to 20; values > 100 return 422).
- `cursor`: Opaque base64url string encoding `{ id: string, val: string, dir: "asc" | "desc" }`.
- `updatedSince`: Optional ISO 8601 UTC timestamp filtering for client delta reconciliation.

### Deterministic Sorting:
Queries order by the primary sort key (e.g. `created_at` or `updated_at`) with entity `id` as the guaranteed unique tie-breaker:
```sql
ORDER BY updated_at ASC, id ASC
```

### Paginated Response Structure:
```json
{
  "items": [ ... ],
  "pageInfo": {
    "hasNextPage": true,
    "endCursor": "eyJpZCI6IjAxYTEwZ...IsImRpciI6ImFzYyJ9",
    "totalCount": 42
  }
}
```

---

## 6. Rate Limiting

Rate limiting is enforced globally and per-route via `@fastify/rate-limit`:
- **Authenticated Users**: 600 requests per minute per user (`usr:{userId}`).
- **Anonymous / IP**: 60 requests per minute per IP (`ip:{ip}`).
- **Stricter Endpoints**: Sensitive endpoints (e.g. authentication, invitations, webhooks) enforce lower thresholds.
- **Header**: HTTP `429 Too Many Requests` returns `Retry-After: <seconds>`.

---

## 7. Architecture A Adapters

| Port | Architecture A Concrete Implementation | Configuration |
|---|---|---|
| **QueuePort** | `PgBossQueueAdapter` | Backed by `pg-boss` running on direct session connection (`DATABASE_DIRECT_URL`). Supports scheduled delays, deduplication singleton keys, and worker subscriptions. |
| **RealtimePort** | `SupabaseRealtimeAdapter` | Broadcasts lightweight invalidation change hints over Supabase Broadcast channels (`org:{orgId}`). |
| **BlobStorePort** | `SupabaseBlobStoreAdapter` | Generates secure 5-minute signed URLs for private files and upload policies. |
| **LLMPort** | `AnthropicLlmAdapter` | SDK-backed Anthropic client supporting `claude-3-5-haiku-latest` and `claude-3-7-sonnet-latest` with structured JSON output, timeouts, and bounded repair loops. |
| **AuthPort** | `SupabaseAuthAdapter` | Handles Google OIDC and email magic links with PKCE state and server-only cookies. |

---

## 8. Transactional Outbox & Background Worker Relay

To guarantee data consistency without distributed transactions, state mutations write both the domain record and an outbox event in the same local database transaction.

### Outbox Schema (`outbox`):
- `id`: UUID (UUIDv7 or `gen_random_uuid()`)
- `org_id`: UUID with foreign key to `orgs.id` (cascading on delete)
- `topic`: Event/job topic (e.g. `system.ping`, `org.maintenance`, `task.upserted`)
- `payload`: JSONB event payload
- `delivery_attempts`: Integer (incremented on lease)
- `locked_at` / `locked_by`: Lease tracking
- `last_error`: Text message on failure
- `sent_at`: Timestamp on successful delivery

### Batch Claiming with `SELECT ... FOR UPDATE SKIP LOCKED`:
The worker claims events in batches without blocking concurrent workers:
```sql
WITH claimable AS (
  SELECT id
  FROM outbox
  WHERE sent_at IS NULL
    AND (locked_at IS NULL OR locked_at < NOW() - (60 || ' seconds')::interval)
  ORDER BY created_at ASC
  LIMIT 50
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox
SET locked_at = NOW(),
    locked_by = $1,
    delivery_attempts = delivery_attempts + 1
FROM claimable
WHERE outbox.id = claimable.id
RETURNING *;
```

### Worker Delivery Lifecycle:
1. **Dispatch**: Depending on topic, dispatches to `ports.queue.enqueue()` or `ports.realtime.publish()`.
2. **Success**: Marks record delivered (`sent_at = NOW()`, locks cleared).
3. **Failure**: Records error (`last_error = error`, locks cleared) so exponential backoff can retry up to `maxRetries = 5`.
4. **Retention Cleanup**: Daily job purges delivered outbox entries older than 7 days and deletes expired idempotency keys.
5. **Liveness & Readiness**: Worker exposes internal `/healthz` (liveness) and `/readyz` (direct database & queue connectivity) on `WORKER_PORT`.
