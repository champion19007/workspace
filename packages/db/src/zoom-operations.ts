import crypto from 'node:crypto';
import {
  type ZoomIntegrationDTO,
  type ZoomHostConsentDTO,
  type ZoomHostConsentStatus,
  type ZoomTokenResponse,
  type SecretStorePort,
  type ZoomClientPort,
  ConflictError,
  NotFoundError,
  ValidationError,
  AuthorizationError,
  IntegrationError,
} from '@workspace/core';
import { loginSql, tenantSql, type Sql } from './client.js';

interface RawIntegrationRow {
  id: string;
  org_id: string;
  provider: string;
  account_id: string;
  account_name: string | null;
  account_email: string | null;
  scopes: string[];
  secret_arn: string;
  status: string;
  connection_generation: number;
  installed_at: string;
  installed_by: string | null;
  last_refreshed_at: string | null;
  last_error_category: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface RawHostConsentRow {
  id: string;
  org_id: string;
  integration_id: string;
  zoom_user_id: string;
  zoom_email: string;
  zoom_name: string | null;
  user_id?: string | null;
  consent_status: string;
  consent_timestamp: string | null;
  policy_version: string;
  admin_disabled: boolean;
  created_at: string;
  updated_at: string;
}

function mapIntegration(row: RawIntegrationRow): ZoomIntegrationDTO {
  return {
    id: row.id,
    orgId: row.org_id,
    provider: 'zoom',
    accountId: row.account_id,
    accountName: row.account_name,
    accountEmail: row.account_email,
    scopes: Array.isArray(row.scopes) ? row.scopes : (typeof row.scopes === 'string' ? JSON.parse(row.scopes) : []),
    status: row.status as ZoomIntegrationDTO['status'],
    connectionGeneration: row.connection_generation,
    installedAt: new Date(row.installed_at).toISOString(),
    installedBy: row.installed_by,
    lastRefreshedAt: row.last_refreshed_at ? new Date(row.last_refreshed_at).toISOString() : null,
    lastErrorCategory: row.last_error_category,
    lastErrorMessage: row.last_error_message,
  };
}

function mapHostConsent(row: RawHostConsentRow): ZoomHostConsentDTO {
  return {
    id: row.id,
    orgId: row.org_id,
    integrationId: row.integration_id,
    zoomUserId: row.zoom_user_id,
    zoomEmail: row.zoom_email,
    zoomName: row.zoom_name,
    userId: row.user_id || null,
    consentStatus: row.consent_status as ZoomHostConsentStatus,
    consentTimestamp: row.consent_timestamp ? new Date(row.consent_timestamp).toISOString() : null,
    policyVersion: row.policy_version,
    adminDisabled: row.admin_disabled,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Creates cryptographically secure, single-use state and PKCE verifier/challenge.
 */
export async function createOAuthState(
  db: Sql,
  params: {
    orgId: string;
    userId: string;
    sessionId: string;
    redirectUri: string;
    ttlMinutes?: number;
  }
): Promise<{ state: string; codeVerifier: string; codeChallenge: string }> {
  const sql = tenantSql(db, { orgId: params.orgId, userId: params.userId });
  const state = crypto.randomBytes(32).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const ttl = params.ttlMinutes || 10;
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();

  await sql`
    INSERT INTO zoom_oauth_states (
      state,
      org_id,
      user_id,
      session_id,
      code_verifier,
      redirect_uri,
      expires_at
    )
    VALUES (
      ${state},
      ${params.orgId},
      ${params.userId},
      ${params.sessionId},
      ${codeVerifier},
      ${params.redirectUri},
      ${expiresAt}
    )
  `;

  return { state, codeVerifier, codeChallenge };
}

/**
 * Consumes single-use OAuth state atomically.
 * Prevents replay attacks and validates session/tenant binding.
 */
export async function consumeOAuthState(
  db: Sql,
  params: {
    state: string;
    orgId: string;
    userId: string;
  }
): Promise<{
  state: string;
  orgId: string;
  userId: string;
  codeVerifier: string;
  redirectUri: string;
}> {
  const sql = tenantSql(db, { orgId: params.orgId, userId: params.userId });
  const rows = await sql<Array<{
    state: string;
    org_id: string;
    user_id: string;
    code_verifier: string;
    redirect_uri: string;
    expires_at: string;
  }>>`
    DELETE FROM zoom_oauth_states
    WHERE state = ${params.state}
    RETURNING *
  `;

  if (rows.length === 0) {
    throw new ValidationError('Invalid or already-consumed OAuth state parameter');
  }

  const row = rows[0]!;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new ValidationError('OAuth state parameter has expired. Please initiate connection again.');
  }

  if (row.org_id !== params.orgId) {
    throw new AuthorizationError('OAuth state does not match tenant organization');
  }

  if (row.user_id !== params.userId) {
    throw new AuthorizationError('OAuth state does not match initiating user');
  }

  return {
    state: row.state,
    orgId: row.org_id,
    userId: row.user_id,
    codeVerifier: row.code_verifier,
    redirectUri: row.redirect_uri,
  };
}

/**
 * Retrieves the Zoom integration for an organization.
 */
export async function getZoomIntegration(
  db: Sql,
  orgId: string,
  /** Integration rows are visible to the organization's Owners and Admins (RLS). */
  userId?: string
): Promise<ZoomIntegrationDTO | null> {
  const rows = await tenantSql(db, { orgId, userId })<RawIntegrationRow[]>`
    SELECT * FROM integrations
    WHERE org_id = ${orgId} AND provider = 'zoom'
    LIMIT 1
  `;

  if (rows.length === 0) {
    return null;
  }

  return mapIntegration(rows[0]!);
}

/**
 * Connects or reconnects Zoom account for an organization.
 * Validates multi-tenant isolation (at most 1 active Workspace org per Zoom account).
 * Stores tokens exclusively in managed secret store.
 * Increments connection generation fencing counter.
 */
export async function connectZoomIntegration(
  db: Sql,
  secretStore: SecretStorePort,
  zoomClient: ZoomClientPort,
  params: {
    orgId: string;
    userId: string;
    accountId: string;
    accountName?: string | null;
    accountEmail?: string | null;
    scopes: string[];
    tokens: ZoomTokenResponse;
  }
): Promise<ZoomIntegrationDTO> {
  const sql = tenantSql(db, { orgId: params.orgId, userId: params.userId });

  // 1. Check for collision across active integrations (resolved across organizations):
  // At most one active Workspace organization per Zoom account (also enforced by
  // uq_integrations_active_provider_account).
  const [existing] = await loginSql(db)<Array<{ org_id: string }>>`
    SELECT org_id FROM sys_zoom_account_integration(${params.accountId})
  `;

  if (existing && existing.org_id !== params.orgId) {
    throw new ConflictError('This Zoom account is already connected to another organization in Workspace');
  }

  // 2. Persist tokens in managed Secret Store
  const expiresAt = new Date(Date.now() + params.tokens.expires_in * 1000).toISOString();
  const secretPayload = {
    accessToken: params.tokens.access_token,
    refreshToken: params.tokens.refresh_token,
    tokenType: params.tokens.token_type,
    expiresAt,
    scope: params.tokens.scope.split(' '),
  };

  const { secretArn } = await secretStore.storeSecret(`zoom:${params.orgId}`, secretPayload);

  // 3. Upsert integration record with generation bump
  const rows = await sql.begin(async (txn) => {
    const updatedRows = await txn<RawIntegrationRow[]>`
      INSERT INTO integrations (
        org_id,
        provider,
        account_id,
        scopes,
        secret_arn,
        status,
        connection_generation,
        installed_at,
        installed_by,
        account_name,
        account_email,
        last_refreshed_at,
        last_error_category,
        last_error_message,
        updated_at
      )
      VALUES (
        ${params.orgId},
        'zoom',
        ${params.accountId},
        ${JSON.stringify(params.scopes)}::jsonb,
        ${secretArn},
        'connected',
        1,
        now(),
        ${params.userId},
        ${params.accountName || null},
        ${params.accountEmail || null},
        now(),
        NULL,
        NULL,
        now()
      )
      ON CONFLICT (org_id, provider) DO UPDATE SET
        account_id = EXCLUDED.account_id,
        scopes = EXCLUDED.scopes,
        secret_arn = EXCLUDED.secret_arn,
        status = 'connected',
        connection_generation = integrations.connection_generation + 1,
        installed_at = now(),
        installed_by = EXCLUDED.installed_by,
        account_name = EXCLUDED.account_name,
        account_email = EXCLUDED.account_email,
        last_refreshed_at = now(),
        last_error_category = NULL,
        last_error_message = NULL,
        updated_at = now()
      RETURNING *
    `;

    const integrationRow = updatedRows[0]!;

    // Insert outbox event for connection lifecycle
    await txn`
      INSERT INTO outbox (org_id, topic, payload)
      VALUES (
        ${params.orgId},
        'integration.zoom.connected',
        ${JSON.stringify({
          orgId: params.orgId,
          accountId: params.accountId,
          installedBy: params.userId,
          generation: integrationRow.connection_generation,
          connectedAt: new Date().toISOString(),
        })}::jsonb
      )
    `;

    return updatedRows;
  });

  const integration = mapIntegration(rows[0]!);

  // 4. Sync discovered account hosts into zoom_host_consents
  try {
    const accountUsers = await zoomClient.listAccountUsers(params.tokens.access_token);
    for (const u of accountUsers) {
      const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
      await sql`
        INSERT INTO zoom_host_consents (
          org_id,
          integration_id,
          zoom_user_id,
          zoom_email,
          zoom_name,
          consent_status
        )
        VALUES (
          ${params.orgId},
          ${integration.id},
          ${u.id},
          ${u.email},
          ${displayName},
          'unknown'
        )
        ON CONFLICT (org_id, zoom_user_id) DO UPDATE SET
          zoom_email = EXCLUDED.zoom_email,
          zoom_name = EXCLUDED.zoom_name,
          updated_at = now()
      `;
    }
  } catch {
    // Non-fatal: host discovery sync can be retried or populated on-demand
  }

  return integration;
}

/**
 * Disconnects Zoom integration.
 * Revokes token with Zoom, purges secret from secret store, marks state disconnected,
 * bumps connection generation, and emits outbox event.
 */
export async function disconnectZoomIntegration(
  db: Sql,
  secretStore: SecretStorePort,
  zoomClient: ZoomClientPort,
  params: {
    orgId: string;
    userId: string;
    role: string;
  }
): Promise<ZoomIntegrationDTO> {
  if (params.role !== 'owner' && params.role !== 'admin') {
    throw new AuthorizationError('Only organization Owners or Admins can disconnect integrations');
  }
  const sql = tenantSql(db, { orgId: params.orgId, userId: params.userId, role: params.role });

  const existingRows = await sql<RawIntegrationRow[]>`
    SELECT * FROM integrations
    WHERE org_id = ${params.orgId} AND provider = 'zoom'
    LIMIT 1
  `;

  if (existingRows.length === 0) {
    throw new NotFoundError('Zoom integration not found');
  }

  const current = existingRows[0]!;

  // 1. Best-effort revocation of token with Zoom
  try {
    const secret = await secretStore.getSecret(current.secret_arn);
    if (secret?.accessToken) {
      await zoomClient.revokeToken(secret.accessToken);
    }
  } catch {
    // Revocation best-effort
  }

  // 2. Immediately purge credentials from Secret Store
  try {
    await secretStore.deleteSecret(current.secret_arn);
  } catch {
    // Best-effort delete
  }

  // 3. Mark disconnected, bump generation, emit outbox event
  const updatedRows = await sql.begin(async (txn) => {
    const rows = await txn<RawIntegrationRow[]>`
      UPDATE integrations
      SET status = 'disconnected',
          connection_generation = connection_generation + 1,
          last_error_category = NULL,
          last_error_message = NULL,
          updated_at = now()
      WHERE org_id = ${params.orgId} AND provider = 'zoom'
      RETURNING *
    `;

    await txn`
      INSERT INTO outbox (org_id, topic, payload)
      VALUES (
        ${params.orgId},
        'integration.zoom.disconnected',
        ${JSON.stringify({
          orgId: params.orgId,
          accountId: current.account_id,
          disconnectedBy: params.userId,
          disconnectedAt: new Date().toISOString(),
        })}::jsonb
      )
    `;

    return rows;
  });

  return mapIntegration(updatedRows[0]!);
}

/**
 * Lists host consents for an organization.
 */
export async function listZoomHostConsents(
  db: Sql,
  params: {
    orgId: string;
    query?: string;
    consentStatus?: string;
  }
): Promise<ZoomHostConsentDTO[]> {
  const sql = tenantSql(db, { orgId: params.orgId });
  let rows: RawHostConsentRow[];

  if (params.consentStatus && params.query) {
    const qPattern = `%${params.query.trim().toLowerCase()}%`;
    rows = await sql<RawHostConsentRow[]>`
      SELECT * FROM zoom_host_consents
      WHERE org_id = ${params.orgId}
        AND consent_status = ${params.consentStatus}
        AND (LOWER(zoom_email) LIKE ${qPattern} OR LOWER(COALESCE(zoom_name, '')) LIKE ${qPattern})
      ORDER BY zoom_email ASC
    `;
  } else if (params.consentStatus) {
    rows = await sql<RawHostConsentRow[]>`
      SELECT * FROM zoom_host_consents
      WHERE org_id = ${params.orgId}
        AND consent_status = ${params.consentStatus}
      ORDER BY zoom_email ASC
    `;
  } else if (params.query) {
    const qPattern = `%${params.query.trim().toLowerCase()}%`;
    rows = await sql<RawHostConsentRow[]>`
      SELECT * FROM zoom_host_consents
      WHERE org_id = ${params.orgId}
        AND (LOWER(zoom_email) LIKE ${qPattern} OR LOWER(COALESCE(zoom_name, '')) LIKE ${qPattern})
      ORDER BY zoom_email ASC
    `;
  } else {
    rows = await sql<RawHostConsentRow[]>`
      SELECT * FROM zoom_host_consents
      WHERE org_id = ${params.orgId}
      ORDER BY zoom_email ASC
    `;
  }

  return rows.map(mapHostConsent);
}

/**
 * Updates host consent status or admin processing override.
 */
export async function updateZoomHostConsent(
  db: Sql,
  params: {
    orgId: string;
    zoomUserId: string;
    consentStatus?: ZoomHostConsentStatus;
    adminDisabled?: boolean;
    role: string;
    /** The acting user: consent rows are written by Owners/Admins (or the host itself, see updateMyHostConsent). */
    userId?: string;
  }
): Promise<ZoomHostConsentDTO> {
  const sql = tenantSql(db, { orgId: params.orgId, userId: params.userId, role: params.role });
  // Disabling host processing or changing status requires admin or owner role
  if (params.adminDisabled !== undefined && params.role !== 'owner' && params.role !== 'admin') {
    throw new AuthorizationError('Only organization Owners or Admins can toggle host processing overrides');
  }

  const existingRows = await sql<RawHostConsentRow[]>`
    SELECT * FROM zoom_host_consents
    WHERE org_id = ${params.orgId} AND zoom_user_id = ${params.zoomUserId}
    LIMIT 1
  `;

  if (existingRows.length === 0) {
    throw new NotFoundError(`Host with Zoom user ID "${params.zoomUserId}" not found`);
  }

  const current = existingRows[0]!;
  const newStatus = params.consentStatus !== undefined ? params.consentStatus : current.consent_status;
  const newAdminDisabled = params.adminDisabled !== undefined ? params.adminDisabled : current.admin_disabled;
  const consentTimestamp =
    params.consentStatus === 'opted_in'
      ? new Date().toISOString()
      : current.consent_timestamp
        ? new Date(current.consent_timestamp).toISOString()
        : null;

  const rows = await sql<RawHostConsentRow[]>`
    UPDATE zoom_host_consents
    SET consent_status = ${newStatus},
        admin_disabled = ${newAdminDisabled},
        consent_timestamp = ${consentTimestamp},
        updated_at = now()
    WHERE org_id = ${params.orgId} AND zoom_user_id = ${params.zoomUserId}
    RETURNING *
  `;

  return mapHostConsent(rows[0]!);
}

/**
 * Refresh Coordinator with distributed lease/locking and generation fencing.
 * Ensures:
 * 1. Tokens are refreshed before the final 5 minutes of validity
 * 2. Concurrent workers do not perform duplicate refreshes or race on rotation
 * 3. Connection generation fencing prevents stale in-flight workers from overwriting newer tokens
 * 4. Invalid grant / revocation transitions connection to needs_reauthorization cleanly
 */
export async function getOrRefreshZoomCredentials(
  db: Sql,
  secretStore: SecretStorePort,
  zoomClient: ZoomClientPort,
  orgId: string
): Promise<{ accessToken: string; accountId: string }> {
  // Credentials are refreshed by background processing on behalf of the organization.
  const sql = tenantSql(db, { orgId, system: true });
  // Step 1: Read current integration
  const rows = await sql<RawIntegrationRow[]>`
    SELECT * FROM integrations
    WHERE org_id = ${orgId} AND provider = 'zoom'
    LIMIT 1
  `;

  if (rows.length === 0 || rows[0]!.status === 'disconnected') {
    throw new IntegrationError('Zoom integration is disconnected for this organization', { status: 'disconnected' });
  }

  const integration = rows[0]!;

  if (integration.status === 'needs_reauthorization') {
    throw new IntegrationError('Zoom integration requires reauthorization', {
      status: 'needs_reauthorization',
      category: integration.last_error_category,
      message: integration.last_error_message,
    });
  }

  // Step 2: Fetch stored secret
  const secret = await secretStore.getSecret(integration.secret_arn);
  if (!secret) {
    await sql`
      UPDATE integrations
      SET status = 'needs_reauthorization',
          last_error_category = 'missing_secret',
          last_error_message = 'Credentials not found in secret store',
          updated_at = now()
      WHERE id = ${integration.id}
    `;
    throw new IntegrationError('Zoom credentials missing from secure store; reauthorization required');
  }

  // Step 3: Check remaining validity (5 minutes = 300,000ms threshold)
  const expiresAtMs = new Date(secret.expiresAt).getTime();
  const remainingValidityMs = expiresAtMs - Date.now();

  if (remainingValidityMs > 300_000) {
    // Valid and far from expiry — return immediately
    return {
      accessToken: secret.accessToken,
      accountId: integration.account_id,
    };
  }

  // Step 4: Token near-expiry or expired — Coordinate refresh with locking & fencing
  return await sql.begin(async (txn) => {
    // Distributed transaction lock on org integration refresh
    await txn`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext('zoom_refresh'))`;

    // Double check: re-fetch secret under lock
    const latestSecret = await secretStore.getSecret(integration.secret_arn);
    if (latestSecret) {
      const latestExpiry = new Date(latestSecret.expiresAt).getTime();
      if (latestExpiry - Date.now() > 300_000) {
        return {
          accessToken: latestSecret.accessToken,
          accountId: integration.account_id,
        };
      }
    }

    const currentRefreshToken = latestSecret?.refreshToken || secret.refreshToken;
    const expectedGeneration = integration.connection_generation;

    // Rotate token pair via Zoom client
    const rotated = await zoomClient.refreshToken(currentRefreshToken);
    const newExpiresAt = new Date(Date.now() + rotated.expires_in * 1000).toISOString();
    const newPayload = {
      accessToken: rotated.access_token,
      refreshToken: rotated.refresh_token,
      tokenType: rotated.token_type,
      expiresAt: newExpiresAt,
      scope: rotated.scope.split(' '),
    };

    const { secretArn: newSecretArn } = await secretStore.storeSecret(`zoom:${orgId}`, newPayload);

    // Atomic update with generation fencing check
    const updateRows = await txn<RawIntegrationRow[]>`
      UPDATE integrations
      SET secret_arn = ${newSecretArn},
          last_refreshed_at = now(),
          last_error_category = NULL,
          last_error_message = NULL,
          updated_at = now()
      WHERE org_id = ${orgId}
        AND provider = 'zoom'
        AND connection_generation = ${expectedGeneration}
      RETURNING *
    `;

    if (updateRows.length === 0) {
      // Generation was bumped while refresh was in-flight (stale worker)
      // Discard result safely
      return {
        accessToken: rotated.access_token,
        accountId: integration.account_id,
      };
    }

    await txn`
      INSERT INTO outbox (org_id, topic, payload)
      VALUES (
        ${orgId},
        'integration.zoom.refreshed',
        ${JSON.stringify({
          orgId,
          accountId: integration.account_id,
          refreshedAt: new Date().toISOString(),
        })}::jsonb
      )
    `;

    return {
      accessToken: rotated.access_token,
      accountId: integration.account_id,
    };
  }).catch(async (err) => {
    const error = err as { code?: string; message?: string };
    if (error.code === 'invalid_grant' || (error.message && error.message.includes('Invalid grant'))) {
      await sql`
        UPDATE integrations
        SET status = 'needs_reauthorization',
            last_error_category = 'token_revoked',
            last_error_message = ${error.message || 'Token revoked or expired'},
            updated_at = now()
        WHERE org_id = ${orgId} AND provider = 'zoom'
      `;

      await sql`
        INSERT INTO outbox (org_id, topic, payload)
        VALUES (
          ${orgId},
          'integration.zoom.degraded',
          ${JSON.stringify({
            orgId,
            accountId: integration.account_id,
            reason: 'invalid_grant',
            degradedAt: new Date().toISOString(),
          })}::jsonb
        )
      `;

      throw new IntegrationError('Zoom credentials revoked or expired; reauthorization required', {
        category: 'token_revoked',
      });
    }

    throw err;
  });
}

/**
 * Retrieves the host consent status for the calling user.
 */
export async function getMyHostConsent(
  db: Sql,
  params: {
    orgId: string;
    userId: string;
    userEmail?: string;
  }
): Promise<ZoomHostConsentDTO | null> {
  const { orgId, userId, userEmail } = params;
  const sql = tenantSql(db, { orgId, userId });
  const rows = await sql<RawHostConsentRow[]>`
    SELECT * FROM zoom_host_consents
    WHERE org_id = ${orgId}
      AND (
        user_id = ${userId}
        ${userEmail ? sql`OR LOWER(zoom_email) = LOWER(${userEmail})` : sql``}
      )
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return mapHostConsent(rows[0]!);
}

/**
 * Updates the host consent status for the calling user (self-service opt-in/opt-out).
 * Fences in-flight processing and triggers cleanup if opting out.
 */
export async function updateMyHostConsent(
  db: Sql,
  params: {
    orgId: string;
    userId: string;
    userEmail: string;
    userName?: string;
    consentStatus: 'opted_in' | 'opted_out';
  }
): Promise<ZoomHostConsentDTO> {
  const { orgId, userId, userEmail, userName, consentStatus } = params;
  const sql = tenantSql(db, { orgId, userId });

  // Check existing consent record
  const existingRows = await sql<RawHostConsentRow[]>`
    SELECT * FROM zoom_host_consents
    WHERE org_id = ${orgId}
      AND (
        user_id = ${userId}
        OR LOWER(zoom_email) = LOWER(${userEmail})
      )
    LIMIT 1
  `;

  const existing = existingRows[0];
  if (existing && existing.admin_disabled) {
    throw new AuthorizationError('Host transcription has been disabled by workspace administrator and cannot be modified');
  }

  const consentTimestamp = consentStatus === 'opted_in' ? new Date().toISOString() : null;

  let updated: RawHostConsentRow;
  if (existing) {
    // If user is opting out, fence in-flight processing for meetings hosted by this user
    if (consentStatus === 'opted_out') {
      await sql`
        UPDATE meetings
        SET 
          processing_generation = processing_generation + 1,
          status = CASE WHEN status IN ('waiting_for_transcript', 'ready_for_transcript_retrieval', 'ingesting', 'routing', 'awaiting_project_choice') THEN 'skipped' ELSE status END,
          skipped = CASE WHEN status IN ('waiting_for_transcript', 'ready_for_transcript_retrieval', 'ingesting', 'routing', 'awaiting_project_choice') THEN true ELSE skipped END,
          intake_error = CASE WHEN status IN ('waiting_for_transcript', 'ready_for_transcript_retrieval', 'ingesting', 'routing', 'awaiting_project_choice') THEN 'Host opted out of meeting processing' ELSE intake_error END,
          cleanup_status = CASE WHEN status IN ('waiting_for_transcript', 'ready_for_transcript_retrieval', 'ingesting', 'routing', 'awaiting_project_choice') THEN 'pending' ELSE cleanup_status END,
          updated_at = NOW()
        WHERE org_id = ${orgId} AND (host_id = ${userId} OR LOWER(zoom_host_email) = LOWER(${userEmail}))
      `;
    }

    const rows = await sql<RawHostConsentRow[]>`
      UPDATE zoom_host_consents
      SET 
        user_id = ${userId},
        consent_status = ${consentStatus},
        consent_timestamp = ${consentTimestamp},
        updated_at = NOW()
      WHERE id = ${existing.id}
      RETURNING *
    `;
    updated = rows[0]!;
  } else {
    // Integration rows are Owner/Admin-only: the tenant-confined helper returns just its id.
    const [integration] = await sql<Array<{ id: string | null }>>`
      SELECT sys_zoom_integration_id_for_tenant() AS id
    `;
    if (!integration?.id) {
      throw new NotFoundError('No Zoom integration found for organization');
    }

    const rows = await sql<RawHostConsentRow[]>`
      INSERT INTO zoom_host_consents (
        org_id, integration_id, zoom_user_id, zoom_email, zoom_name, user_id, consent_status, consent_timestamp, policy_version
      )
      VALUES (
        ${orgId}, ${integration.id}, ${'usr_' + userId.slice(0, 12)}, ${userEmail}, ${userName || null}, ${userId}, ${consentStatus}, ${consentTimestamp}, '1.0'
      )
      RETURNING *
    `;
    updated = rows[0]!;
  }

  return mapHostConsent(updated);
}

