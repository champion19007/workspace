'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  History,
  Check,
  Loader2,
  AlertCircle,
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Code,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Link as LinkIcon,
  SquareCode,
  ArrowLeft,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { SafeMarkdownView } from './SafeMarkdownView';
import { DocHistoryDrawer } from './DocHistoryDrawer';
import { Alert } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import type { DocDTO } from '@workspace/core';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict';

interface DocEditorProps {
  initialDoc: DocDTO;
  orgId: string;
  isViewer?: boolean;
  backHref?: string;
  onDocUpdated?: (doc: DocDTO) => void;
}

const FORMAT_ACTIONS: { label: string; icon: LucideIcon; prefix: string; suffix?: string; groupEnd?: boolean }[] = [
  { label: 'Heading 1', icon: Heading1, prefix: '# ' },
  { label: 'Heading 2', icon: Heading2, prefix: '## ' },
  { label: 'Heading 3', icon: Heading3, prefix: '### ', groupEnd: true },
  { label: 'Bold', icon: Bold, prefix: '**', suffix: '**' },
  { label: 'Italic', icon: Italic, prefix: '*', suffix: '*' },
  { label: 'Inline code', icon: Code, prefix: '`', suffix: '`', groupEnd: true },
  { label: 'Bulleted list', icon: List, prefix: '- ' },
  { label: 'Numbered list', icon: ListOrdered, prefix: '1. ' },
  { label: 'Checklist', icon: CheckSquare, prefix: '- [ ] ' },
  { label: 'Quote', icon: Quote, prefix: '> ' },
  { label: 'Link', icon: LinkIcon, prefix: '[', suffix: '](https://)' },
  { label: 'Code block', icon: SquareCode, prefix: '```\n', suffix: '\n```' },
];

export function DocEditor({
  initialDoc,
  orgId,
  isViewer = false,
  backHref,
  onDocUpdated,
}: DocEditorProps) {
  // Current canonical document state
  const [doc, setDoc] = useState<DocDTO>(initialDoc);
  const [title, setTitle] = useState(initialDoc.title);
  const [content, setContent] = useState(initialDoc.bodyMd);

  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>(isViewer ? 'preview' : 'split');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Save coordinator state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflictEntity, setConflictEntity] = useState<DocDTO | null>(null);

  // Generation watermarking for 1-second autosave coordinator
  const draftGenRef = useRef(0);
  const submittedGenRef = useRef(0);
  const inFlightRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronized refs to avoid closure staleness
  const docRef = useRef(doc);
  docRef.current = doc;
  const titleRef = useRef(title);
  titleRef.current = title;
  const contentRef = useRef(content);
  contentRef.current = content;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Check if current text differs from last acknowledged document
  const isDirty = title !== doc.title || content !== doc.bodyMd;

  useEffect(() => {
    document.title = `${title || 'Untitled'} · Workspace`;
  }, [title]);

  // -------------------------------------------------------------------------
  // 1-Second Autosave Execution
  // -------------------------------------------------------------------------
  const performSave = useCallback(
    async (manual = false) => {
      if (isViewer) return;

      const currentTitle = titleRef.current.trim();
      const currentContent = contentRef.current;
      const currentCanonical = docRef.current;

      if (!currentTitle) return;

      if (currentTitle === currentCanonical.title && currentContent === currentCanonical.bodyMd && !manual) {
        setSaveStatus('saved');
        return;
      }

      // If already in flight, flag will trigger another pass on completion
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      const genToSubmit = draftGenRef.current;
      submittedGenRef.current = genToSubmit;
      setSaveStatus('saving');
      setErrorMessage(null);

      try {
        const res = await fetch(`/api/orgs/${orgId}/docs/${currentCanonical.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': `"v${currentCanonical.version}"`,
          },
          body: JSON.stringify({
            title: currentTitle,
            bodyMd: currentContent,
          }),
        });

        if (res.status === 412) {
          const errorData = await res.json().catch(() => ({}));
          const fresh = errorData.details?.currentEntity || null;
          setConflictEntity(fresh);
          setSaveStatus('conflict');
          return;
        }

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.message || "Your changes couldn't be saved.");
        }

        const updatedDoc: DocDTO = await res.json();
        setDoc(updatedDoc);
        docRef.current = updatedDoc;
        if (onDocUpdated) onDocUpdated(updatedDoc);

        // Check if user continued typing while save was in flight
        if (draftGenRef.current > genToSubmit) {
          setSaveStatus('unsaved');
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            performSave();
          }, 1000);
        } else {
          setSaveStatus('saved');
        }
      } catch (err) {
        setSaveStatus('error');
        setErrorMessage((err as Error).message || "Couldn't reach the server.");
      } finally {
        inFlightRef.current = false;
      }
    },
    [isViewer, orgId, onDocUpdated]
  );

  const scheduleSave = () => {
    draftGenRef.current += 1;
    setSaveStatus('unsaved');
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      performSave();
    }, 1000);
  };

  const handleContentChange = (newContent: string) => {
    if (isViewer) return;
    setContent(newContent);
    scheduleSave();
  };

  const handleTitleChange = (newTitle: string) => {
    if (isViewer) return;
    setTitle(newTitle);
    scheduleSave();
  };

  // -------------------------------------------------------------------------
  // Browser Unload Protection
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && saveStatus !== 'saved') {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [isDirty, saveStatus]);

  const insertFormatting = (prefix: string, suffix = '') => {
    if (isViewer) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = textarea.value;
    const selected = current.substring(start, end);

    const replacement = prefix + (selected || 'text') + suffix;
    const updated = current.substring(0, start) + replacement + current.substring(end);

    handleContentChange(updated);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selected.length || 4));
    }, 0);
  };

  // -------------------------------------------------------------------------
  // Conflict Resolution (412 Recovery)
  // -------------------------------------------------------------------------
  const handleOverwriteConflict = async () => {
    if (!conflictEntity) return;
    setDoc(conflictEntity);
    docRef.current = conflictEntity;
    setConflictEntity(null);
    setSaveStatus('unsaved');
    performSave(true);
  };

  const handleDiscardConflict = () => {
    if (!conflictEntity) return;
    setDoc(conflictEntity);
    docRef.current = conflictEntity;
    setTitle(conflictEntity.title);
    setContent(conflictEntity.bodyMd);
    setConflictEntity(null);
    setSaveStatus('saved');
    setErrorMessage(null);
  };

  const words = content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Title row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Link
            href={backHref ?? `/orgs/${orgId}/docs`}
            className="btn btn-ghost btn-icon btn-sm mt-0.5 shrink-0"
            aria-label="Back to docs"
            title="Back to docs"
          >
            <ArrowLeft aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            {isViewer ? (
              <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
            ) : (
              <input
                type="text"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Untitled"
                aria-label="Title"
                className="w-full rounded-md bg-transparent px-1 py-0.5 text-xl font-semibold tracking-tight text-fg placeholder:text-fg-subtle hover:bg-surface-2 focus-visible:bg-surface"
              />
            )}
            <p className="px-1 text-xs text-fg-muted">
              {doc.node?.name && <span>{doc.node.name} · </span>}
              Edited {formatDateTime(doc.updatedAt)} by {doc.updater?.name || 'someone'} · {words.toLocaleString()} words
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-10 sm:pl-0">
          {!isViewer && (
            <span role="status" className="flex items-center gap-1.5 text-xs text-fg-muted">
              {saveStatus === 'saving' && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                  Saved
                </>
              )}
              {saveStatus === 'unsaved' && 'Unsaved changes'}
              {saveStatus === 'error' && (
                <span className="flex items-center gap-1 text-danger">
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Not saved
                </span>
              )}
              {saveStatus === 'conflict' && <span className="text-warning">Edit conflict</span>}
            </span>
          )}

          <div className="segmented" role="group" aria-label="Layout">
            {!isViewer && (
              <button type="button" aria-pressed={viewMode === 'edit'} onClick={() => setViewMode('edit')}>
                Write
              </button>
            )}
            <button type="button" aria-pressed={viewMode === 'preview'} onClick={() => setViewMode('preview')}>
              Preview
            </button>
            {!isViewer && (
              <button type="button" aria-pressed={viewMode === 'split'} onClick={() => setViewMode('split')} className="!hidden md:!inline-flex">
                Split
              </button>
            )}
          </div>

          <button type="button" onClick={() => setIsHistoryOpen(true)} className="btn btn-secondary btn-sm">
            <History aria-hidden="true" />
            History
          </button>
        </div>
      </div>

      {isViewer && (
        <Alert tone="info">
          <span className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            You can read this doc but not edit it.
          </span>
        </Alert>
      )}

      {saveStatus === 'conflict' && conflictEntity && (
        <Alert tone="warning" title="Someone else saved this doc while you were typing">
          <p>Your text is still here. Keep yours and replace theirs, or switch to their version.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={handleOverwriteConflict} className="btn btn-secondary btn-sm">
              Keep my text
            </button>
            <button type="button" onClick={handleDiscardConflict} className="btn btn-ghost btn-sm">
              Use their version
            </button>
          </div>
        </Alert>
      )}

      {saveStatus === 'error' && errorMessage && (
        <Alert
          action={
            <button type="button" onClick={() => performSave(true)} className="link shrink-0">
              Try again
            </button>
          }
        >
          {errorMessage}
        </Alert>
      )}

      <div className="card overflow-hidden">
        {!isViewer && viewMode !== 'preview' && (
          <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5">
            {FORMAT_ACTIONS.map(({ label, icon: Icon, prefix, suffix, groupEnd }) => (
              <React.Fragment key={label}>
                <button
                  type="button"
                  onClick={() => insertFormatting(prefix, suffix)}
                  aria-label={label}
                  title={label}
                  className="btn btn-ghost btn-icon btn-sm h-8 w-8 shrink-0"
                >
                  <Icon aria-hidden="true" />
                </button>
                {groupEnd && <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />}
              </React.Fragment>
            ))}
          </div>
        )}

        <div className={`grid min-h-[28rem] ${viewMode === 'split' ? 'md:grid-cols-2 md:divide-x md:divide-border' : ''}`}>
          {(viewMode === 'edit' || viewMode === 'split') && (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              disabled={isViewer}
              aria-label="Doc text (Markdown)"
              placeholder="Write in Markdown. # for headings, - for lists, **bold**."
              className="h-[calc(100dvh-20rem)] min-h-[28rem] w-full resize-none bg-transparent p-5 font-mono text-[13px] leading-relaxed text-fg placeholder:text-fg-subtle focus-visible:outline-none"
            />
          )}

          {(viewMode === 'preview' || viewMode === 'split') && (
            <div className={`h-[calc(100dvh-20rem)] min-h-[28rem] overflow-y-auto p-5 ${viewMode === 'split' ? 'hidden md:block' : ''}`}>
              <div className="mx-auto max-w-[68ch]">
                <SafeMarkdownView content={content} />
              </div>
            </div>
          )}
        </div>
      </div>

      <DocHistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        docId={doc.id}
        orgId={orgId}
        currentVersion={doc.version}
        canRestore={!isViewer}
        onVersionRestored={(restored) => {
          setDoc(restored);
          docRef.current = restored;
          setTitle(restored.title);
          setContent(restored.bodyMd);
          setSaveStatus('saved');
          setErrorMessage(null);
          setConflictEntity(null);
          if (onDocUpdated) onDocUpdated(restored);
        }}
      />
    </div>
  );
}
