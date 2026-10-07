'use client';

import React, { useState, useEffect } from 'react';
import { X, Clock, RotateCcw, AlertTriangle, Eye, CheckCircle2 } from 'lucide-react';
import { SafeMarkdownView } from './SafeMarkdownView';
import type { DocDTO, DocVersionDTO } from '@workspace/core';

interface DocHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  docId: string;
  orgId: string;
  currentVersion: number;
  canRestore: boolean;
  onVersionRestored: (restoredDoc: DocDTO) => void;
}

export function DocHistoryDrawer({
  isOpen,
  onClose,
  docId,
  orgId,
  currentVersion,
  canRestore,
  onVersionRestored,
}: DocHistoryDrawerProps) {
  const [versions, setVersions] = useState<DocVersionDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected snapshot for inspection
  const [selectedSnapshot, setSelectedSnapshot] = useState<DocVersionDTO | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);

  // Restore confirmation modal
  const [restoreConfirmVersion, setRestoreConfirmVersion] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !docId) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);
    setSelectedSnapshot(null);

    fetch(`/api/orgs/${orgId}/docs/${docId}/versions`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load version history');
        return res.json();
      })
      .then((data) => {
        if (isMounted) {
          setVersions(data.versions || []);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, docId, orgId, currentVersion]);

  // Load specific snapshot content when clicked
  const handleSelectVersion = async (vNum: number) => {
    setIsLoadingSnapshot(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/docs/${docId}/versions/${vNum}`);
      if (!res.ok) throw new Error('Failed to load version snapshot');
      const data = await res.json();
      setSelectedSnapshot(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoadingSnapshot(false);
    }
  };

  // Perform version restore
  const handleConfirmRestore = async () => {
    if (restoreConfirmVersion === null) return;

    setIsRestoring(true);
    setRestoreError(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/docs/${docId}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"v${currentVersion}"`,
        },
        body: JSON.stringify({ version: restoreConfirmVersion }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 412) {
          throw new Error('Document was updated by someone else while viewing history. Please refresh before restoring.');
        }
        throw new Error(errorData.message || 'Failed to restore version');
      }

      const restoredDoc: DocDTO = await res.json();
      setRestoreConfirmVersion(null);
      setSelectedSnapshot(null);
      onVersionRestored(restoredDoc);
      onClose();
    } catch (err: any) {
      setRestoreError(err.message);
    } finally {
      setIsRestoring(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-xl lg:max-w-2xl bg-panel border-l border-border-subtle shadow-2xl flex flex-col justify-between">
          {/* Header */}
          <div className="p-4 lg:p-6 border-b border-border-subtle flex items-center justify-between bg-panel-elevated/40">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">Document Version History</h2>
                <p className="text-[11px] text-muted-foreground">
                  Retaining latest 30 snapshots with immutable revision tracking
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-inset transition-colors"
              aria-label="Close history drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer Body: Two Column / Split view when snapshot selected */}
          <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4">
            {isLoading || isLoadingSnapshot ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-muted-foreground">
                  {isLoadingSnapshot ? 'Loading snapshot...' : 'Loading snapshots...'}
                </p>
              </div>
            ) : error ? (
              <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                {error}
              </div>
            ) : selectedSnapshot ? (
              /* Selected Snapshot Inspection View */
              <div className="space-y-4 animate-in fade-in duration-150">
                <div className="flex items-center justify-between p-3 rounded-xl bg-panel-inset border border-border-subtle">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedSnapshot(null)}
                      className="text-xs text-accent hover:underline font-semibold"
                    >
                      &larr; Back to all versions
                    </button>
                    <span className="text-muted-foreground">|</span>
                    <span className="text-xs font-bold text-foreground">
                      Version {selectedSnapshot.version} Preview
                    </span>
                    {selectedSnapshot.version === currentVersion && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        Current
                      </span>
                    )}
                  </div>

                  {canRestore && selectedSnapshot.version !== currentVersion && (
                    <button
                      onClick={() => setRestoreConfirmVersion(selectedSnapshot.version)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-foreground font-bold text-xs shadow-sm hover:opacity-90 transition-opacity"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore this version</span>
                    </button>
                  )}
                </div>

                {/* Metadata Pill */}
                <div className="p-3 rounded-xl bg-panel-inset border border-border-subtle text-xs space-y-1">
                  <div className="text-[11px] text-muted-foreground">
                    Snapshot created on{' '}
                    <span className="text-foreground font-medium">
                      {new Date(selectedSnapshot.createdAt).toLocaleString()}
                    </span>{' '}
                    by{' '}
                    <span className="text-foreground font-medium">
                      {selectedSnapshot.creator?.name || 'Unknown User'}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-foreground">
                    Title: {selectedSnapshot.title}
                  </div>
                </div>

                {/* Safe Markdown Content View */}
                <div className="p-4 rounded-xl bg-panel-inset border border-border-subtle overflow-y-auto max-h-[500px]">
                  <SafeMarkdownView content={selectedSnapshot.bodyMd} />
                </div>
              </div>
            ) : (
              /* Versions List */
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Snapshots ({versions.length} of 30 retained)
                </div>

                {versions.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-8 text-center italic">
                    No version snapshots found.
                  </p>
                ) : (
                  versions.map((v) => {
                    const isCurrent = v.version === currentVersion;
                    return (
                      <div
                        key={v.id}
                        className={`p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                          isCurrent
                            ? 'bg-panel-elevated/60 border-accent/40 shadow-sm'
                            : 'bg-panel-inset border-border-subtle hover:border-border-strong hover:bg-panel-elevated/30'
                        }`}
                      >
                        <div className="min-w-0 pr-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono font-bold text-foreground">
                              v{v.version}
                            </span>
                            {isCurrent && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                Current
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(v.createdAt).toLocaleString()}
                            </span>
                          </div>

                          <div className="text-xs font-medium text-foreground/90 truncate">
                            {v.title}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            Author: {v.creator?.name || 'Unknown User'}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleSelectVersion(v.version)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-panel hover:bg-panel-elevated border border-border-subtle text-foreground text-xs font-medium transition-colors"
                            title="Preview historical snapshot"
                          >
                            <Eye className="w-3.5 h-3.5 text-accent" />
                            <span>Preview</span>
                          </button>

                          {canRestore && !isCurrent && (
                            <button
                              onClick={() => setRestoreConfirmVersion(v.version)}
                              className="p-1.5 rounded-lg bg-panel hover:bg-accent hover:text-accent-foreground border border-border-subtle text-muted-foreground hover:border-transparent transition-all"
                              title="Restore this version"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border-subtle bg-panel-elevated/40 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Restoring creates a <strong className="text-foreground">NEW</strong> version and never deletes historical snapshots.
            </span>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-panel hover:bg-panel-inset border border-border-subtle text-foreground text-xs font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Restore Confirmation Dialog */}
      {restoreConfirmVersion !== null && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-panel border border-border-subtle shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-accent">
              <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center">
                <RotateCcw className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Restore Version {restoreConfirmVersion}?
                </h3>
                <p className="text-xs text-muted-foreground">
                  Create a new revision from historical snapshot
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-panel-inset border border-border-subtle text-xs text-muted-foreground space-y-2 leading-relaxed">
              <p>
                Restoring <strong className="text-foreground">Version {restoreConfirmVersion}</strong> will copy its title and Markdown content into a{' '}
                <strong className="text-accent">NEW Version {currentVersion + 1}</strong>.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                Your existing version history (including Version {currentVersion}) will be safely preserved.
              </p>
            </div>

            {restoreError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{restoreError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRestoreConfirmVersion(null);
                  setRestoreError(null);
                }}
                disabled={isRestoring}
                className="px-4 py-2 rounded-xl bg-panel-inset hover:bg-panel-elevated border border-border-subtle text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={isRestoring}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isRestoring ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-accent-foreground border-t-transparent rounded-full animate-spin" />
                    <span>Restoring...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Confirm Restore</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
