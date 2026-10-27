'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { MAX_FILE_BYTES, type FileDTO } from '@workspace/core';
import { Alert } from '@/components/ui/states';
import { formatRelativeTime } from '@/lib/format';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const MAX_MB = MAX_FILE_BYTES / 1024 / 1024;

/** A project's files, or one task's attachments, with upload by button or by dragging files onto it. */
export function FilePanel({
  orgId,
  nodeId,
  taskId,
  canUpload,
  emptyText = 'No files yet.',
}: {
  orgId: string;
  nodeId: string;
  taskId?: string;
  canUpload: boolean;
  emptyText?: string;
}) {
  const [files, setFiles] = useState<FileDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = taskId ? `taskId=${taskId}` : `nodeId=${nodeId}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/files?${query}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Files couldn't be loaded.");
      setFiles(body.files);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [orgId, query]);

  useEffect(() => {
    setFiles(null);
    load();
  }, [load]);

  const upload = async (picked: File[]) => {
    const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length > 0) {
      setError(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over the ${MAX_MB} MB limit.`);
    }
    for (const file of picked.filter((f) => f.size <= MAX_FILE_BYTES)) {
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.set('file', file);
        form.set('nodeId', nodeId);
        if (taskId) form.set('taskId', taskId);
        const res = await fetch(`/api/orgs/${orgId}/files`, { method: 'POST', body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.detail || `${file.name} couldn't be uploaded.`);
        setFiles((prev) => [body, ...(prev ?? [])]);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const remove = async (file: FileDTO) => {
    if (!confirm(`Delete ${file.name}?`)) return;
    const res = await fetch(`/api/orgs/${orgId}/files/${file.id}`, { method: 'DELETE' });
    if (res.ok) setFiles((prev) => prev?.filter((f) => f.id !== file.id) ?? null);
    else setError(`${file.name} couldn't be deleted.`);
  };

  const dropHandlers = canUpload
    ? {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragging(false);
          upload(Array.from(e.dataTransfer.files));
        },
      }
    : {};

  return (
    <div className="space-y-3" {...dropHandlers}>
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      {canUpload && (
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors ${
            dragging ? 'border-accent bg-accent-subtle' : 'border-border-strong'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              upload(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <button type="button" onClick={() => inputRef.current?.click()} className="btn btn-secondary btn-sm">
            <Upload aria-hidden="true" />
            Upload files
          </button>
          <span className="text-fg-muted">or drag them here. Up to {MAX_MB} MB each.</span>
          {uploading > 0 && (
            <span role="status" className="text-fg-muted">
              Uploading…
            </span>
          )}
        </div>
      )}

      {files === null ? (
        <div className="skeleton h-12 w-full" />
      ) : files.length === 0 ? (
        <p className="text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="card divide-y divide-border overflow-hidden">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <Paperclip className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/orgs/${orgId}/files/${f.id}`}
                  target="_blank"
                  rel="noopener"
                  className="block truncate font-medium text-fg hover:underline"
                >
                  {f.name}
                </a>
                <p className="truncate text-xs text-fg-muted">
                  {formatBytes(f.sizeBytes)} · {f.uploadedBy?.name ?? 'Someone'} · {formatRelativeTime(f.createdAt)}
                  {!taskId && f.taskLabel && ` · on ${f.taskLabel}`}
                </p>
              </div>
              <a
                href={`/api/orgs/${orgId}/files/${f.id}?download`}
                aria-label={`Download ${f.name}`}
                title="Download"
                className="btn btn-ghost btn-icon"
              >
                <Download aria-hidden="true" />
              </a>
              {f.canDelete && (
                <button
                  type="button"
                  onClick={() => remove(f)}
                  aria-label={`Delete ${f.name}`}
                  title="Delete"
                  className="btn btn-ghost btn-icon hover:text-danger"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
