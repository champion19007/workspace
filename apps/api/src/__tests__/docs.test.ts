import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseConfig,
  signInternalApiRequest,
  sanitizeMarkdown,
  extractMarkdownExcerpt,
} from '@workspace/core';
import { buildServer, type ServerInstance } from '../server.js';
import {
  findOrCreateUserByEmail,
  createOrganizationWithOwner,
  createNode,
  type DatabaseInstance,
  type Sql,
} from '@workspace/db';

describe('Stage 10 Documents, Autosave & Version History (Requirement N-3)', () => {
  const secret = 'test-origin-verify-secret-token-16-chars';
  const testConfig = parseConfig({
    DATABASE_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    DATABASE_DIRECT_URL: 'postgresql://workspace_user:workspace_dev_password@localhost:5432/workspace_dev',
    ORIGIN_VERIFY_SECRET: secret,
    PORT: 8095,
    QUEUE_PROVIDER: 'in_memory',
    REALTIME_PROVIDER: 'in_memory',
    LLM_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'in_memory',
    AUTH_PROVIDER: 'mock',
  });

  let server: ServerInstance;
  let db: DatabaseInstance;
  let sql: Sql;

  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };
  let outsiderUser: { id: string; email: string };

  let testOrg: { id: string; slug: string };
  let otherOrg: { id: string; slug: string };

  let publicTeamId: string;
  let publicProjectId: string;
  let privateProjectId: string;

  beforeAll(async () => {
    server = buildServer(testConfig);
    db = server.db;
    sql = server.sql;

    // 1. Seed test users
    const owner = await findOrCreateUserByEmail(db, { email: 'stage10-owner@example.com', name: 'Stage 10 Owner' });
    ownerUser = { id: owner.id, email: owner.email };

    const member = await findOrCreateUserByEmail(db, { email: 'stage10-member@example.com', name: 'Stage 10 Member' });
    memberUser = { id: member.id, email: member.email };

    const viewer = await findOrCreateUserByEmail(db, { email: 'stage10-viewer@example.com', name: 'Stage 10 Viewer' });
    viewerUser = { id: viewer.id, email: viewer.email };

    const outsider = await findOrCreateUserByEmail(db, { email: 'stage10-outsider@example.com', name: 'Stage 10 Outsider' });
    outsiderUser = { id: outsider.id, email: outsider.email };

    // 2. Primary organization
    const { org: primaryOrg } = await createOrganizationWithOwner(db, {
      name: 'Stage 10 Docs Org',
      slug: `stage10-docs-org-${Date.now()}`,
      userId: ownerUser.id,
    });
    testOrg = { id: primaryOrg.id, slug: primaryOrg.slug };

    // Add member & viewer to primary org
    await sql`
      INSERT INTO memberships (org_id, user_id, role, session_epoch)
      VALUES 
        (${testOrg.id}, ${memberUser.id}, 'member', 1),
        (${testOrg.id}, ${viewerUser.id}, 'viewer', 1)
      ON CONFLICT DO NOTHING
    `;

    // 3. Secondary organization (cross-tenant tests)
    const { org: secondaryOrg } = await createOrganizationWithOwner(db, {
      name: 'Stage 10 Other Org',
      slug: `stage10-other-org-${Date.now()}`,
      userId: outsiderUser.id,
    });
    otherOrg = { id: secondaryOrg.id, slug: secondaryOrg.slug };

    // 4. Create public team & project
    const team = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Product Architecture Team',
      kind: 'team',
      parentId: null,
      visibility: 'public',
    });
    publicTeamId = team.id;

    const pubProj = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Workspace Core Specifications',
      kind: 'project',
      parentId: publicTeamId,
      visibility: 'public',
    });
    publicProjectId = pubProj.id;

    // 5. Create private project
    const privProj = await createNode(db, {
      orgId: testOrg.id,
      userId: ownerUser.id,
      role: 'owner',
      name: 'Confidential Strategy',
      kind: 'project',
      parentId: publicTeamId,
      visibility: 'private',
    });
    privateProjectId = privProj.id;
  }, 30000);

  afterAll(async () => {
    if (testOrg) {
      await sql`DELETE FROM orgs WHERE id = ${testOrg.id}`;
    }
    if (otherOrg) {
      await sql`DELETE FROM orgs WHERE id = ${otherOrg.id}`;
    }
    await sql`DELETE FROM users WHERE email LIKE 'stage10-%'`;
    await server.close();
  }, 30000);

  function createAuthHeaders(userId: string, email: string, timestamp = Date.now()) {
    const signature = signInternalApiRequest({ userId, email, timestamp }, secret);
    return {
      'x-workspace-user-id': userId,
      'x-workspace-user-email': email,
      'x-workspace-timestamp': timestamp.toString(),
      'x-workspace-signature': signature,
    };
  }

  describe('1. Document Creation & Initial Version Snapshot', () => {
    it('creates document under project node, initializing at version 1 with initial snapshot', async () => {
      const payload = {
        nodeId: publicProjectId,
        title: 'System Design Spec v1',
        bodyMd: '# Architecture Overview\n\nThis document describes Workspace v1 architecture.',
      };

      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${publicProjectId}/docs`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
        payload,
      });

      expect(res.statusCode).toBe(201);
      const created = res.json();
      expect(created.id).toBeDefined();
      expect(created.title).toBe(payload.title);
      expect(created.bodyMd).toBe(payload.bodyMd);
      expect(created.version).toBe(1);
      expect(created.orgId).toBe(testOrg.id);
      expect(created.nodeId).toBe(publicProjectId);
      expect(created.createdBy).toBe(memberUser.id);
      expect(created.updatedBy).toBe(memberUser.id);
      expect(created.creator?.name).toBe('Stage 10 Member');
      expect(created.node?.name).toBe('Workspace Core Specifications');

      // Verify Strong ETag in response
      expect(res.headers.etag).toBe('"v1"');

      // Verify initial snapshot exists in doc_versions table
      const versionsRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${created.id}/versions`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      expect(versionsRes.statusCode).toBe(200);
      const versionList = versionsRes.json();
      expect(versionList.versions).toHaveLength(1);
      expect(versionList.versions[0].version).toBe(1);
      expect(versionList.versions[0].title).toBe(payload.title);
    });

    it('creates document directly under team node via org-level docs endpoint', async () => {
      const payload = {
        nodeId: publicTeamId,
        title: 'Team Onboarding Guidelines',
        bodyMd: '# Onboarding Guidelines\n\nWelcome to Product Architecture!',
      };

      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload,
      });

      expect(res.statusCode).toBe(201);
      const created = res.json();
      expect(created.nodeId).toBe(publicTeamId);
      expect(created.version).toBe(1);
      expect(res.headers.etag).toBe('"v1"');
    });

    it('rejects creation by read-only Viewer with HTTP 403', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs`,
        headers: createAuthHeaders(viewerUser.id, viewerUser.email),
        payload: {
          nodeId: publicProjectId,
          title: 'Unauthorized Doc',
          bodyMd: 'Viewer should not be able to create this.',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('2. Isolation & Private Project Zero-Leakage (404)', () => {
    let privateDocId: string;

    beforeAll(async () => {
      // Create document in private project as Owner
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          nodeId: privateProjectId,
          title: 'Top Secret Strategy 2027',
          bodyMd: '# Confidential\n\nRestricted access only.',
        },
      });
      expect(res.statusCode).toBe(201);
      privateDocId = res.json().id;
    }, 15000);

    it('returns HTTP 404 (zero leakage) when non-member user tries to get document in private project', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${privateDocId}`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      // Must be 404, not 403, to ensure zero-leakage of private project existence
      expect(res.statusCode).toBe(404);
    });

    it('allows explicit private project member to read document', async () => {
      // Grant member explicit access to private project via API
      const addRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/nodes/${privateProjectId}/members`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: { userId: memberUser.id, role: 'member' },
      });
      expect(addRes.statusCode).toBe(201);

      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${privateDocId}`,
        headers: createAuthHeaders(memberUser.id, memberUser.email),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe('Top Secret Strategy 2027');
    });

    it('returns HTTP 403 for outsider from different organization attempting cross-org access', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${privateDocId}`,
        headers: createAuthHeaders(outsiderUser.id, outsiderUser.email),
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('3. Concurrency Protection (RFC 9110 Strong ETags & If-Match)', () => {
    let docId: string;
    let initialVersion: number;

    beforeAll(async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          nodeId: publicProjectId,
          title: 'Concurrency Benchmark Document',
          bodyMd: 'Initial content for OCC test.',
        },
      });
      const data = res.json();
      docId = data.id;
      initialVersion = data.version;
    }, 15000);

    it('rejects mutation when If-Match header is omitted with HTTP 428 Precondition Required', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          title: 'Updated without If-Match',
        },
      });

      expect(res.statusCode).toBe(428);
    });

    it('rejects mutation when weak ETag is supplied with HTTP 412 Precondition Failed', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': `W/"v${initialVersion}"`,
        },
        payload: {
          title: 'Updated with weak ETag',
        },
      });

      expect(res.statusCode).toBe(412);
      expect(res.json().code).toBe('PRECONDITION_FAILED');
    });

    it('rejects mutation when version mismatch occurs with HTTP 412 and provides fresh currentEntity', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v999"',
        },
        payload: {
          title: 'Updated with stale version',
        },
      });

      expect(res.statusCode).toBe(412);
      const body = res.json();
      expect(body.code).toBe('PRECONDITION_FAILED');
      const currentEntity = body.currentEntity || body.details?.currentEntity;
      expect(currentEntity).toBeDefined();
      expect(currentEntity.version).toBe(initialVersion);
      expect(res.headers.etag).toBe(`"v${initialVersion}"`);
    });

    it('successfully mutates document when matching strong If-Match is provided', async () => {
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': `"v${initialVersion}"`,
        },
        payload: {
          title: 'Concurrency Benchmark Document (Updated)',
          bodyMd: 'Updated content with matching ETag.',
        },
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.version).toBe(initialVersion + 1);
      expect(updated.title).toBe('Concurrency Benchmark Document (Updated)');
      expect(res.headers.etag).toBe(`"v${initialVersion + 1}"`);
    });
  });

  describe('4. No-Op Save Detection', () => {
    let docId: string;
    let currentVersion: number;

    beforeAll(async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          nodeId: publicProjectId,
          title: 'No-Op Detection Test Document',
          bodyMd: 'Static content.',
        },
      });
      const data = res.json();
      docId = data.id;
      currentVersion = data.version;
    }, 15000);

    it('returns current document without incrementing version or creating snapshot when changes are identical', async () => {
      // Save with identical title and bodyMd
      const res = await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': `"v${currentVersion}"`,
        },
        payload: {
          title: 'No-Op Detection Test Document',
          bodyMd: 'Static content.',
        },
      });

      expect(res.statusCode).toBe(200);
      const saved = res.json();
      expect(saved.version).toBe(currentVersion);

      // Verify no extra snapshot was created in doc_versions
      const versionsRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}/versions`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(versionsRes.statusCode).toBe(200);
      expect(versionsRes.json().versions).toHaveLength(1);
    });
  });

  describe('5. 30-Version Retention Limit & Historical Pruning', () => {
    let docId: string;

    beforeAll(async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          nodeId: publicProjectId,
          title: 'Retention Test Doc - Version 1',
          bodyMd: 'Initial content v1',
        },
      });
      docId = res.json().id;
    }, 15000);

    it('prunes oldest snapshots when version count exceeds 30, strictly retaining latest 30 snapshots', async () => {
      // Increment document through version 35 (34 additional updates)
      let currentVer = 1;
      for (let i = 2; i <= 35; i++) {
        const updateRes = await server.app.inject({
          method: 'PATCH',
          url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}`,
          headers: {
            ...createAuthHeaders(ownerUser.id, ownerUser.email),
            'if-match': `"v${currentVer}"`,
          },
          payload: {
            title: `Retention Test Doc - Version ${i}`,
            bodyMd: `Updated content iteration #${i} for retention verification.`,
          },
        });

        expect(updateRes.statusCode).toBe(200);
        currentVer = updateRes.json().version;
      }

      expect(currentVer).toBe(35);

      // Fetch snapshot list from version history endpoint
      const versionsRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}/versions`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(versionsRes.statusCode).toBe(200);
      const list = versionsRes.json().versions;

      // Must be capped at exactly MAX_RETAINED_VERSIONS (30)
      expect(list).toHaveLength(30);

      // Newest should be version 35
      expect(list[0].version).toBe(35);
      // Oldest retained should be version 6 (v1 through v5 were pruned)
      expect(list[29].version).toBe(6);

      // Verify pruned version 1 returns 404
      const prunedRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}/versions/1`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(prunedRes.statusCode).toBe(404);

      // Verify retained version 10 is accessible with exact snapshot content
      const retainedRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}/versions/10`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });
      expect(retainedRes.statusCode).toBe(200);
      const v10 = retainedRes.json();
      expect(v10.version).toBe(10);
      expect(v10.title).toBe('Retention Test Doc - Version 10');
      expect(v10.bodyMd).toBe('Updated content iteration #10 for retention verification.');
    }, 60000);
  });

  describe('6. Monotonic Version Restore Semantics', () => {
    let docId: string;

    beforeAll(async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          nodeId: publicProjectId,
          title: 'Original Title v1',
          bodyMd: 'Golden Master Content v1',
        },
      });
      docId = res.json().id;

      // Update to v2
      await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v1"',
        },
        payload: {
          title: 'Draft Changes v2',
          bodyMd: 'Experimental breaking changes v2',
        },
      });

      // Update to v3
      await server.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v2"',
        },
        payload: {
          title: 'More Experimental Changes v3',
          bodyMd: 'Unwanted broken content v3',
        },
      });
    }, 20000);

    it('restores historical version 1 as a NEW monotonic version 4 without overwriting previous snapshots', async () => {
      // Target version to restore: 1; current document version: 3
      const restoreRes = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}/restore`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v3"',
        },
        payload: {
          version: 1,
        },
      });

      expect(restoreRes.statusCode).toBe(200);
      const restored = restoreRes.json();

      // Restored entity must have monotonic version 4
      expect(restored.version).toBe(4);
      // Its content must match historical snapshot 1
      expect(restored.title).toBe('Original Title v1');
      expect(restored.bodyMd).toBe('Golden Master Content v1');
      expect(restoreRes.headers.etag).toBe('"v4"');

      // History must retain all 4 snapshots (v1, v2, v3, v4)
      const historyRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}/versions`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(historyRes.statusCode).toBe(200);
      const versions = historyRes.json().versions;
      expect(versions).toHaveLength(4);
      expect(versions.map((v: any) => v.version)).toEqual([4, 3, 2, 1]);
    });

    it('rejects restore if targetVersion does not exist in retained snapshots', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}/restore`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v4"',
        },
        payload: {
          version: 999,
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('7. Document Archival (Soft Delete)', () => {
    let docId: string;

    beforeAll(async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/${testOrg.slug}/docs`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
        payload: {
          nodeId: publicProjectId,
          title: 'Document to be Archived',
          bodyMd: 'Temporary content.',
        },
      });
      docId = res.json().id;
    }, 15000);

    it('archives document with strong If-Match OCC validation', async () => {
      const res = await server.app.inject({
        method: 'DELETE',
        url: `/api/v1/orgs/${testOrg.slug}/docs/${docId}`,
        headers: {
          ...createAuthHeaders(ownerUser.id, ownerUser.email),
          'if-match': '"v1"',
        },
      });

      expect(res.statusCode).toBe(200);
      const archived = res.json();
      expect(archived.archivedAt).toBeDefined();

      // Archived document is excluded from active listings
      const listRes = await server.app.inject({
        method: 'GET',
        url: `/api/v1/orgs/${testOrg.slug}/docs`,
        headers: createAuthHeaders(ownerUser.id, ownerUser.email),
      });

      expect(listRes.statusCode).toBe(200);
      const found = listRes.json().docs.find((d: any) => d.id === docId);
      expect(found).toBeUndefined();
    });
  });

  describe('8. Markdown Sanitization & Excerpt Extraction', () => {
    it('strips dangerous HTML scripts, iframes, and inline event handlers', () => {
      const maliciousMd = `# Safe Heading
<script>alert('xss')</script>
<iframe src="evil.html"></iframe>
<img src="valid.png" onerror="alert('pwnd')">
<a href="javascript:stealCookies()">Click me</a>
Safe paragraph text.`;

      const sanitized = sanitizeMarkdown(maliciousMd);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('alert(');
      expect(sanitized).not.toContain('<iframe');
      expect(sanitized).not.toContain('onerror=');
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).toContain('# Safe Heading');
      expect(sanitized).toContain('Safe paragraph text.');
    });

    it('extracts clean plaintext excerpt without markdown tags', () => {
      const markdown = `# Main Title
This is **bold** and *italic* text in a [link](https://example.com).
- Item 1
- Item 2

> Important quotation.`;

      const excerpt = extractMarkdownExcerpt(markdown, 100);
      expect(excerpt).not.toContain('#');
      expect(excerpt).not.toContain('**');
      expect(excerpt).toContain('Main Title');
      expect(excerpt).toContain('This is bold and italic text in a link');
    });
  });
});
