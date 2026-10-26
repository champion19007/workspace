'use client';

import React, { useState, useEffect, useId } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Plus, Search, Archive, SearchX } from 'lucide-react';
import type { DocListItemDTO } from '@workspace/core';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Alert, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { formatRelativeTime } from '@/lib/format';

interface NodeOption {
  id: string;
  name: string;
  kind: 'team' | 'project';
  visibility: 'public' | 'private';
}

interface DocListProps {
  orgId: string;
  /** Scope to one project/team (inside a project's Docs tab); links then stay inside the project. */
  nodeId?: string;
  isViewer?: boolean;
  nodes?: NodeOption[];
}

export function DocList({ orgId, nodeId, isViewer = false, nodes = [] }: DocListProps) {
  const router = useRouter();
  const ids = useId();
  const [docs, setDocs] = useState<DocListItemDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedNodeFilter, setSelectedNodeFilter] = useState<string>(nodeId || 'all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodeId || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [docToArchive, setDocToArchive] = useState<DocListItemDTO | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const docHref = (docId: string) => (nodeId ? `/orgs/${orgId}/projects/${nodeId}/docs/${docId}` : `/orgs/${orgId}/docs/${docId}`);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!selectedNodeId && nodes[0]) setSelectedNodeId(nodes[0].id);
  }, [nodes, selectedNodeId]);

  const fetchDocs = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nodeId) params.set('nodeId', nodeId);
      else if (selectedNodeFilter !== 'all') params.set('nodeId', selectedNodeFilter);
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());

      const res = await fetch(`/api/orgs/${orgId}/docs?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Docs couldn't be loaded.");
      }

      const data = await res.json();
      setDocs(data.docs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [orgId, nodeId, selectedNodeFilter, debouncedSearch]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const targetNode = selectedNodeId || nodeId;
    if (!targetNode) {
      setCreateError('Choose the project or team this doc belongs to.');
      return;
    }

    setIsSubmitting(true);
    setCreateError(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: targetNode,
          title: newTitle.trim(),
          bodyMd: `# ${newTitle.trim()}\n\n`,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "The doc couldn't be created.");
      }

      const created = await res.json();
      setIsCreateOpen(false);
      setNewTitle('');
      router.push(docHref(created.id));
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!docToArchive) return;
    setIsArchiving(true);

    try {
      const res = await fetch(`/api/orgs/${orgId}/docs/${docToArchive.id}`, {
        method: 'DELETE',
        headers: { 'If-Match': `"v${docToArchive.version}"` },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `“${docToArchive.title}” couldn't be archived.`);
      }

      setDocs((prev) => prev.filter((d) => d.id !== docToArchive.id));
      setDocToArchive(null);
    } catch (err: any) {
      setActionError(err.message);
      setDocToArchive(null);
    } finally {
      setIsArchiving(false);
    }
  };

  const newDocButton = !isViewer && (
    <button type="button" onClick={() => setIsCreateOpen(true)} className={`btn btn-primary ${nodeId ? 'btn-sm' : ''}`}>
      <Plus aria-hidden="true" />
      New doc
    </button>
  );

  const projects = nodes.filter((n) => n.kind === 'project');
  const teams = nodes.filter((n) => n.kind === 'team');

  return (
    <div className="space-y-6">
      {!nodeId && (
        <PageHeader title="Docs" description="Specs, plans and meeting notes, written in Markdown with full version history." actions={newDocButton} />
      )}

      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search titles and text"
              aria-label="Search docs"
              className="field field-sm pl-9"
            />
          </div>
          {!nodeId && nodes.length > 0 && (
            <select
              value={selectedNodeFilter}
              onChange={(e) => setSelectedNodeFilter(e.target.value)}
              aria-label="Project or team"
              className="field field-sm w-auto"
            >
              <option value="all">All projects and teams</option>
              {projects.length > 0 && (
                <optgroup label="Projects">
                  {projects.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {teams.length > 0 && (
                <optgroup label="Teams">
                  {teams.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          {nodeId && <div className="sm:ml-auto">{newDocButton}</div>}
        </div>

        {actionError && <Alert onDismiss={() => setActionError(null)}>{actionError}</Alert>}

        {isLoading && docs.length === 0 ? (
          <SkeletonRows rows={5} />
        ) : error ? (
          <ErrorState title="Couldn't load docs" message={error} onRetry={fetchDocs} />
        ) : docs.length === 0 ? (
          debouncedSearch.trim() ? (
            <EmptyState
              icon={SearchX}
              title="No docs match"
              description={`Nothing contains “${debouncedSearch.trim()}”. Try another word.`}
              action={{ label: 'Clear search', onClick: () => setSearchQuery('') }}
              compact
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="No docs yet"
              description="Write specs, plans or runbooks here. Meeting notes are added automatically once meetings are processed."
              action={!isViewer ? { label: 'New doc', onClick: () => setIsCreateOpen(true), primary: true } : undefined}
            />
          )
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {docs.map((doc) => {
              const who = doc.updater?.name || 'Someone';
              return (
                <li key={doc.id} className="group relative flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <Link href={docHref(doc.id)} className="font-medium text-fg after:absolute after:inset-0 hover:underline">
                      {doc.title}
                    </Link>
                    {doc.excerpt && <p className="mt-0.5 line-clamp-1 text-sm text-fg-muted">{doc.excerpt}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted sm:hidden">
                      {doc.node?.name && !nodeId && <span>{doc.node.name}</span>}
                      <span>Edited {formatRelativeTime(doc.updatedAt)}</span>
                    </p>
                  </div>
                  {!nodeId && doc.node?.name && (
                    <span className="hidden w-40 shrink-0 truncate text-sm text-fg-muted md:block">{doc.node.name}</span>
                  )}
                  <span className="hidden w-40 shrink-0 items-center justify-end gap-2 text-sm text-fg-muted sm:flex">
                    <Avatar name={who} size="xs" />
                    <span className="truncate">{formatRelativeTime(doc.updatedAt)}</span>
                  </span>
                  {!isViewer && (
                    <button
                      type="button"
                      onClick={() => setDocToArchive(doc)}
                      aria-label={`Archive ${doc.title}`}
                      title="Archive"
                      className="btn btn-ghost btn-icon btn-sm relative z-10 -my-1 opacity-100 group-hover:opacity-100 md:opacity-0 md:focus-visible:opacity-100"
                    >
                      <Archive aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="New doc"
        description="You'll go straight to the editor."
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleCreateDocument} className="space-y-4">
          {createError && <Alert>{createError}</Alert>}
          <div>
            <label htmlFor={`${ids}-title`} className="label">
              Title
            </label>
            <input
              id={`${ids}-title`}
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Q1 launch plan"
              className="field"
            />
          </div>

          {!nodeId && nodes.length > 0 && (
            <div>
              <label htmlFor={`${ids}-node`} className="label">
                Belongs to
              </label>
              <select id={`${ids}-node`} value={selectedNodeId} onChange={(e) => setSelectedNodeId(e.target.value)} className="field">
                {projects.length > 0 && (
                  <optgroup label="Projects">
                    {projects.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {teams.length > 0 && (
                  <optgroup label="Teams">
                    {teams.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setIsCreateOpen(false)} disabled={isSubmitting} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting || !newTitle.trim()} className="btn btn-primary">
              {isSubmitting ? 'Creating…' : 'Create and open'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        isOpen={docToArchive !== null}
        onClose={() => setDocToArchive(null)}
        title="Archive this doc?"
        description={docToArchive ? `“${docToArchive.title}” disappears from Docs. Its version history is kept.` : undefined}
        maxWidthClass="max-w-md"
      >
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setDocToArchive(null)} disabled={isArchiving} className="btn btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={handleArchive} disabled={isArchiving} className="btn btn-danger">
            {isArchiving ? 'Archiving…' : 'Archive doc'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
