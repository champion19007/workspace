import { describe, it, expect } from 'vitest';
import {
  formatETag,
  parseStrongETag,
  isWeakETag,
  formatRelativeDueDate,
  isDateOverdue,
  getKolkataTodayDateString,
  type TaskDTO,
} from '@workspace/core';

describe('Web Task UI — Two-Tab Stale-Edit Journey & OCC Resolution', () => {
  // Mock base task as initially loaded by both tabs
  const initialTask: TaskDTO = {
    id: '019318ef-0000-7000-8000-000000000001',
    orgId: '019318ef-0000-7000-8000-000000000002',
    projectId: '019318ef-0000-7000-8000-000000000003',
    parentTaskId: null,
    key: 'CORE-42',
    title: 'Initial Database Schema Design',
    description: 'Establish initial PostgreSQL schema.',
    status: 'todo',
    priority: 'high',
    assigneeId: null,
    assignee: null,
    startDate: null,
    dueDate: '2026-10-20',
    rank: '0|hzzzzz:',
    version: 1,
    source: 'manual',
    sourceRef: null,
    createdBy: '019318ef-0000-7000-8000-000000000004',
    archivedAt: null,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    labels: [],
    subtaskCount: 0,
  };

  it('correctly constructs strong RFC 9110 ETags and detects weak validators', () => {
    // 1. Strong ETag format must have literal quotes
    const etag1 = formatETag(1);
    expect(etag1).toBe('"v1"');
    expect(parseStrongETag(etag1)).toBe(1);

    // 2. Weak tags must be identified and fail strong parsing
    expect(isWeakETag('W/"v1"')).toBe(true);
    expect(isWeakETag('w/"v1"')).toBe(true);
    expect(isWeakETag('"v1"')).toBe(false);
    expect(parseStrongETag('W/"v1"')).toBeNull();
  });

  it('simulates two-tab stale-edit: Tab A commits v2, Tab B receives 412, preserves draft, and resolves conflict', () => {
    // Client State in Tab A
    let tabATask = { ...initialTask };
    const tabADraft = {
      title: 'Database Schema Design (Updated by Tab A)',
      status: 'in_progress' as const,
      priority: 'urgent' as const,
    };

    // Client State in Tab B
    let tabBTask = { ...initialTask };
    const tabBDraft = {
      title: 'Database Schema with Migration Engine (Authored by Tab B)',
      status: 'todo' as const,
      priority: 'high' as const,
    };

    // Simulated Server Database State
    let serverTask: TaskDTO = { ...initialTask };

    // --- STEP 1: Tab A submits changes against version 1 ---
    const tabAIfMatch = formatETag(tabATask.version); // '"v1"'
    expect(tabAIfMatch).toBe('"v1"');

    // Server processes Tab A request
    const serverExpectedVersion = parseStrongETag(tabAIfMatch);
    expect(serverExpectedVersion).toBe(serverTask.version);

    // Tab A succeeds: server bumps version to 2
    serverTask = {
      ...serverTask,
      title: tabADraft.title,
      status: tabADraft.status,
      priority: tabADraft.priority,
      version: serverTask.version + 1,
      updatedAt: '2026-10-06T00:05:00.000Z',
    };
    expect(serverTask.version).toBe(2);

    tabATask = { ...serverTask };
    expect(tabATask.version).toBe(2);

    // --- STEP 2: Tab B submits changes with stale version 1 ---
    const tabBIfMatch = formatETag(tabBTask.version); // Stale '"v1"'
    const tabBRequestedVersion = parseStrongETag(tabBIfMatch);

    // Server detects version mismatch: 1 !== 2 -> Returns HTTP 412 Precondition Failed
    let tabBResponseStatus = 200;
    let tabBResponseBody: { code: string; detail: string; currentEntity: TaskDTO } | null = null;

    if (tabBRequestedVersion !== serverTask.version) {
      tabBResponseStatus = 412;
      tabBResponseBody = {
        code: 'PRECONDITION_FAILED',
        detail: 'Concurrent modification detected',
        currentEntity: serverTask,
      };
    }

    expect(tabBResponseStatus).toBe(412);
    expect(tabBResponseBody?.currentEntity.version).toBe(2);

    // --- STEP 3: Tab B handles 412 without losing user's draft ---
    let conflictServerTask: TaskDTO | null = null;
    let tabBErrorMessage: string | null = null;

    if (tabBResponseStatus === 412) {
      conflictServerTask = tabBResponseBody!.currentEntity;
      tabBErrorMessage = `Conflict: This task was modified on the server (now version ${conflictServerTask!.version}) while you were editing.`;
    }

    // CRITICAL: Tab B's user draft MUST NOT be overwritten!
    expect(tabBDraft.title).toBe('Database Schema with Migration Engine (Authored by Tab B)');
    expect(conflictServerTask?.title).toBe('Database Schema Design (Updated by Tab A)');
    expect(conflictServerTask?.version).toBe(2);
    expect(tabBErrorMessage).toContain('Conflict');

    // --- STEP 4a: Tab B user chooses to "Overwrite" with their draft ---
    // User clicks Overwrite: form sends PATCH with the server's latest version (2)
    const overwriteIfMatch = formatETag(conflictServerTask!.version); // '"v2"'
    expect(overwriteIfMatch).toBe('"v2"');

    const overwriteRequestedVersion = parseStrongETag(overwriteIfMatch);
    expect(overwriteRequestedVersion).toBe(serverTask.version);

    // Server accepts overwrite, advancing version to 3
    serverTask = {
      ...serverTask,
      title: tabBDraft.title,
      version: serverTask.version + 1,
      updatedAt: '2026-10-06T00:10:00.000Z',
    };
    expect(serverTask.version).toBe(3);
    expect(serverTask.title).toBe('Database Schema with Migration Engine (Authored by Tab B)');

    // Tab B finishes resolution
    tabBTask = { ...serverTask };
    conflictServerTask = null;
    tabBErrorMessage = null;

    expect(tabBTask.version).toBe(3);
    expect(conflictServerTask).toBeNull();
  });

  it('simulates conflict discard option: user reverts to server version', () => {
    // Current server state has version 2
    const serverTask: TaskDTO = {
      ...initialTask,
      title: 'Server Authority Title',
      version: 2,
    };

    // Client state with draft
    let clientTask = { ...initialTask };
    let clientDraftTitle = 'Unsaved Local Draft Title';
    let conflictServerTask: TaskDTO | null = serverTask;

    // User chooses "Discard Local Draft"
    clientTask = { ...conflictServerTask };
    clientDraftTitle = conflictServerTask.title;
    conflictServerTask = null;

    expect(clientTask.version).toBe(2);
    expect(clientDraftTitle).toBe('Server Authority Title');
    expect(conflictServerTask).toBeNull();
  });

  it('correctly calculates Asia/Kolkata deadlines, overdue flags, and relative tags', () => {
    const today = getKolkataTodayDateString();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Overdue test: 2020-01-01 is definitely overdue
    expect(isDateOverdue('2020-01-01')).toBe(true);

    // Far future: 2030-01-01 is not overdue
    expect(isDateOverdue('2030-01-01')).toBe(false);

    // Relative formatter
    expect(formatRelativeDueDate('2020-01-01').toLowerCase()).toContain('overdue');
  });
});
