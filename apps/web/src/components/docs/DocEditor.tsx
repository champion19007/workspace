'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Clock,
  Check,
  Loader2,
  AlertCircle,
  Eye,
  Edit3,
  Columns,
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
  ShieldAlert,
  ArrowLeft,
} from 'lucide-react';
import { SafeMarkdownView } from './SafeMarkdownView';
import { DocHistoryDrawer } from './DocHistoryDrawer';
import type { DocDTO } from '@workspace/core';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict';

interface DocEditorProps {
  initialDoc: DocDTO;
  orgId: string;
  isViewer?: boolean;
  backHref?: string;
  onDocUpdated?: (doc: DocDTO) => void;
}

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

  // Editor layout mode
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');

  // History Drawer state
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

  // Textarea ref for inserting formatting
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Check if current text differs from last acknowledged document
  const isDirty = title !== doc.title || content !== doc.bodyMd;

  // -------------------------------------------------------------------------
  // 1-Second Autosave Execution
  // -------------------------------------------------------------------------
  const performSave = useCallback(
    async (manual = false) => {
      if (isViewer) return;

      // Check if dirty
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
          // Precondition failed (Conflict)
          const errorData = await res.json().catch(() => ({}));
          const fresh = errorData.details?.currentEntity || null;
          setConflictEntity(fresh);
          setSaveStatus('conflict');
          setErrorMessage('This document was updated by someone else. Please resolve the conflict below.');
          return;
        }

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to save changes');
        }

        const updatedDoc: DocDTO = await res.json();
        setDoc(updatedDoc);
        docRef.current = updatedDoc;
        if (onDocUpdated) onDocUpdated(updatedDoc);

        // Check if user continued typing while save was in flight
        if (draftGenRef.current > genToSubmit) {
          setSaveStatus('unsaved');
          // Queue next autosave pass
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            performSave();
          }, 1000);
        } else {
          setSaveStatus('saved');
        }
      } catch (err: any) {
        setSaveStatus('error');
        setErrorMessage(err.message || 'Error communicating with server');
      } finally {
        inFlightRef.current = false;
      }
    },
    [isViewer, orgId, onDocUpdated]
  );

  // -------------------------------------------------------------------------
  // Handle Content Changes (Triggers 1s debounce)
  // -------------------------------------------------------------------------
  const handleContentChange = (newContent: string) => {
    if (isViewer) return;
    setContent(newContent);
    draftGenRef.current += 1;
    setSaveStatus('unsaved');

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      performSave();
    }, 1000);
  };

  const handleTitleChange = (newTitle: string) => {
    if (isViewer) return;
    setTitle(newTitle);
    draftGenRef.current += 1;
    setSaveStatus('unsaved');

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      performSave();
    }, 1000);
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

  // -------------------------------------------------------------------------
  // Formatting Toolbar Helper
  // -------------------------------------------------------------------------
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
    // Overwrite using fresh server entity's version
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

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] rounded-2xl bg-panel border border-border-subtle shadow-sm overflow-hidden animate-in fade-in duration-200">
      {/* Top Navbar */}
      <div className="p-3 lg:p-4 border-b border-border-subtle bg-panel-elevated/40 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {backHref ? (
            <Link
              href={backHref}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-inset transition-colors shrink-0"
              title="Back to documents"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
          ) : (
            <Link
              href={`/orgs/${orgId}/docs`}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-inset transition-colors shrink-0"
              title="Back to documents"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
          )}

          <div className="flex items-center gap-2 min-w-0">
            {isViewer ? (
              <h1 className="text-sm lg:text-base font-bold text-foreground truncate">
                {title}
              </h1>
            ) : (
              <input
                type="text"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Untitled Document"
                className="text-sm lg:text-base font-bold text-foreground bg-transparent border-b border-transparent hover:border-border-subtle focus:border-accent focus:outline-none transition-colors px-1 py-0.5 truncate min-w-[200px] max-w-sm lg:max-w-md"
              />
            )}

            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-accent/20 text-accent border border-accent/30 shrink-0">
              v{doc.version}
            </span>

            {doc.node && (
              <span className="hidden sm:inline-block text-[10px] font-medium px-2 py-0.5 rounded bg-panel-inset text-muted-foreground border border-border-subtle shrink-0">
                {doc.node.name}
              </span>
            )}
          </div>
        </div>

        {/* Right Action & Status Controls */}
        <div className="flex items-center gap-2.5">
          {/* Autosave Status Indicator */}
          {!isViewer && (
            <div className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg bg-panel-inset border border-border-subtle">
              {saveStatus === 'saving' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  <span className="text-muted-foreground text-[11px]">Saving...</span>
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 text-[11px]">Saved</span>
                </>
              )}
              {saveStatus === 'unsaved' && (
                <>
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-muted-foreground text-[11px]">Unsaved</span>
                </>
              )}
              {saveStatus === 'error' && (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                  <span className="text-destructive text-[11px]">Save failed</span>
                  <button
                    onClick={() => performSave(true)}
                    className="underline ml-1 text-accent text-[11px] font-bold"
                  >
                    Retry
                  </button>
                </>
              )}
              {saveStatus === 'conflict' && (
                <>
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-amber-400 text-[11px] font-bold">Conflict</span>
                </>
              )}
            </div>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center p-0.5 rounded-lg bg-panel-inset border border-border-subtle">
            <button
              onClick={() => setViewMode('edit')}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                viewMode === 'edit'
                  ? 'bg-panel-elevated text-foreground font-bold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Editor only"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`p-1.5 rounded-md text-xs transition-colors ${
                viewMode === 'preview'
                  ? 'bg-panel-elevated text-foreground font-bold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Preview only"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`p-1.5 rounded-md text-xs transition-colors hidden md:block ${
                viewMode === 'split'
                  ? 'bg-panel-elevated text-foreground font-bold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Side-by-side view"
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Version History Button */}
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-panel-inset hover:bg-panel-elevated border border-border-subtle text-xs text-foreground font-medium transition-colors"
            title="View document revision history"
          >
            <Clock className="w-3.5 h-3.5 text-accent" />
            <span>History</span>
          </button>
        </div>
      </div>

      {/* Read-Only Viewer Banner */}
      {isViewer && (
        <div className="px-4 py-2 bg-panel-inset border-b border-border-subtle flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="w-4 h-4 text-accent" />
          <span>You have read-only permissions for this document. Edits and version restores are disabled.</span>
        </div>
      )}

      {/* Conflict Resolution Banner (412) */}
      {saveStatus === 'conflict' && conflictEntity && (
        <div className="p-4 bg-amber-500/10 border-b border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-foreground">
                Concurrent Edit Conflict: Version {conflictEntity.version} is now available on server.
              </p>
              <p className="text-muted-foreground text-[11px]">
                Your edits are safely retained in memory. Choose whether to overwrite with your text or discard and load the server version.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDiscardConflict}
              className="px-3 py-1.5 rounded-lg bg-panel-inset hover:bg-panel-elevated border border-border-subtle text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Discard my edits & load server
            </button>
            <button
              onClick={handleOverwriteConflict}
              className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground font-bold shadow-sm hover:opacity-90 transition-opacity"
            >
              Overwrite (keep my changes)
            </button>
          </div>
        </div>
      )}

      {/* Save Error Banner */}
      {saveStatus === 'error' && errorMessage && (
        <div className="p-3 bg-destructive/10 border-b border-destructive/30 flex items-center justify-between gap-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => performSave(true)}
            className="underline font-bold hover:opacity-80"
          >
            Retry Save
          </button>
        </div>
      )}

      {/* Formatting Controls Toolbar */}
      {!isViewer && viewMode !== 'preview' && (
        <div className="px-3 py-1.5 border-b border-border-subtle bg-panel-inset flex items-center gap-1 overflow-x-auto text-xs shrink-0">
          <button
            type="button"
            onClick={() => insertFormatting('# ')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Heading 1"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('## ')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Heading 2"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('### ')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Heading 3"
          >
            <Heading3 className="w-3.5 h-3.5" />
          </button>
          <span className="w-px h-3.5 bg-border-subtle mx-1" />
          <button
            type="button"
            onClick={() => insertFormatting('**', '**')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Bold"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('*', '*')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Italic"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('`', '`')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Inline code"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <span className="w-px h-3.5 bg-border-subtle mx-1" />
          <button
            type="button"
            onClick={() => insertFormatting('- ')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Bullet List"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('1. ')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Numbered List"
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('- [ ] ')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Task Checklist"
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('> ')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Quote"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('[', '](https://)')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground"
            title="Insert Link"
          >
            <LinkIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('```\n', '\n```')}
            className="p-1.5 rounded hover:bg-panel-elevated text-muted-foreground hover:text-foreground font-mono text-[10px]"
            title="Code Block"
          >
            {'```'}
          </button>
        </div>
      )}

      {/* Editor & Preview Workspace */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-subtle">
        {/* Left Pane: Markdown Textarea */}
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div className={`h-full flex flex-col ${viewMode === 'edit' ? 'col-span-2' : ''}`}>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              disabled={isViewer}
              placeholder="Type your document content in Markdown..."
              className="flex-1 w-full p-4 lg:p-6 bg-transparent text-foreground placeholder:text-muted-foreground font-mono text-xs leading-relaxed resize-none focus:outline-none"
            />
          </div>
        )}

        {/* Right Pane: Live Safe Preview */}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div
            className={`h-full overflow-y-auto p-4 lg:p-6 bg-panel-inset/30 ${
              viewMode === 'preview' ? 'col-span-2' : ''
            }`}
          >
            <div className="max-w-3xl mx-auto">
              <SafeMarkdownView content={content} />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Status Footer */}
      <div className="px-4 py-2 border-t border-border-subtle bg-panel-elevated/20 flex items-center justify-between text-[11px] text-muted-foreground shrink-0">
        <div>
          Last updated by{' '}
          <span className="text-foreground font-medium">
            {doc.updater?.name || 'Unknown'}
          </span>{' '}
          on {new Date(doc.updatedAt).toLocaleString()}
        </div>
        <div className="flex items-center gap-3">
          <span>{content.length.toLocaleString()} characters</span>
          <span>{content.split(/\s+/).filter(Boolean).length} words</span>
        </div>
      </div>

      {/* Version History Drawer */}
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
