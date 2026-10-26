'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, RotateCcw, Eye } from 'lucide-react';
import { SafeMarkdownView } from './SafeMarkdownView';
import { Drawer } from '@/components/ui/drawer';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
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

  const [selectedSnapshot, setSelectedSnapshot] = useState<DocVersionDTO | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);

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
        if (!res.ok) throw new Error("Version history couldn't be loaded.");
        return res.json();
      })
      .then((data) => {
        if (isMounted) setVersions(data.versions || []);
      })
      .catch((err) => {
        if (isMounted) setError(err.message);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, docId, orgId, currentVersion]);

  const handleSelectVersion = async (vNum: number) => {
    setIsLoadingSnapshot(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/docs/${docId}/versions/${vNum}`);
      if (!res.ok) throw new Error(`Version ${vNum} couldn't be loaded.`);
      setSelectedSnapshot(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoadingSnapshot(false);
    }
  };

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
          throw new Error('Someone edited this doc while you were looking at its history. Reload the page, then restore again.');
        }
        throw new Error(errorData.message || "That version couldn't be restored.");
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

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Version history"
        description="Restoring copies an old version into a new one; nothing is deleted."
        widthClass="max-w-xl w-full"
      >
        {isLoading || isLoadingSnapshot ? (
          <div role="status" aria-busy="true" className="space-y-3">
            <span className="sr-only">Loading…</span>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-14 w-full" />
            ))}
          </div>
        ) : error ? (
          <Alert onDismiss={() => setError(null)}>{error}</Alert>
        ) : selectedSnapshot ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setSelectedSnapshot(null)} className="btn btn-ghost btn-sm -ml-2">
                <ArrowLeft aria-hidden="true" />
                All versions
              </button>
              {canRestore && selectedSnapshot.version !== currentVersion && (
                <button type="button" onClick={() => setRestoreConfirmVersion(selectedSnapshot.version)} className="btn btn-primary btn-sm">
                  <RotateCcw aria-hidden="true" />
                  Restore this version
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                Version {selectedSnapshot.version}
                {selectedSnapshot.version === currentVersion && <Badge variant="success">Current</Badge>}
              </h3>
              <p className="text-xs text-fg-muted">
                {formatDateTime(selectedSnapshot.createdAt)} · {selectedSnapshot.creator?.name || 'Unknown'}
              </p>
            </div>
            <div className="card max-h-[60vh] overflow-y-auto p-4">
              <h4 className="mb-3 text-lg font-semibold text-fg">{selectedSnapshot.title}</h4>
              <SafeMarkdownView content={selectedSnapshot.bodyMd} />
            </div>
          </div>
        ) : versions.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">No earlier versions yet.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-fg-muted">The latest 30 versions are kept.</p>
            <ol className="card divide-y divide-border overflow-hidden">
              {versions.map((v) => {
                const isCurrent = v.version === currentVersion;
                return (
                  <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-fg">
                        Version {v.version}
                        {isCurrent && <Badge variant="success">Current</Badge>}
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {formatDateTime(v.createdAt)} · {v.creator?.name || 'Unknown'}
                      </p>
                    </div>
                    <button type="button" onClick={() => handleSelectVersion(v.version)} className="btn btn-secondary btn-sm">
                      <Eye aria-hidden="true" />
                      View
                    </button>
                    {canRestore && !isCurrent && (
                      <button
                        type="button"
                        onClick={() => setRestoreConfirmVersion(v.version)}
                        className="btn btn-ghost btn-icon btn-sm"
                        aria-label={`Restore version ${v.version}`}
                        title="Restore this version"
                      >
                        <RotateCcw aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </Drawer>

      <Dialog
        isOpen={restoreConfirmVersion !== null}
        onClose={() => {
          setRestoreConfirmVersion(null);
          setRestoreError(null);
        }}
        title={`Restore version ${restoreConfirmVersion ?? ''}?`}
        description={`Its title and text become version ${currentVersion + 1}. Version ${currentVersion} stays in the history.`}
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          {restoreError && <Alert>{restoreError}</Alert>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setRestoreConfirmVersion(null);
                setRestoreError(null);
              }}
              disabled={isRestoring}
              className="btn btn-ghost"
            >
              Cancel
            </button>
            <button type="button" onClick={handleConfirmRestore} disabled={isRestoring} className="btn btn-primary">
              {isRestoring ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
