'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  FileText,
  Plus,
  Search,
  Clock,
  Trash2,
  FolderGit2,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/table-shell';
import type { DocListItemDTO } from '@workspace/core';

interface NodeOption {
  id: string;
  name: string;
  kind: 'team' | 'project';
  visibility: 'public' | 'private';
}

interface DocListProps {
  orgId: string;
  nodeId?: string;
  isViewer?: boolean;
  nodes?: NodeOption[];
}

export function DocList({ orgId, nodeId, isViewer = false, nodes = [] }: DocListProps) {
  const [docs, setDocs] = useState<DocListItemDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeFilter, setSelectedNodeFilter] = useState<string>(nodeId || 'all');

  // New Document modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodeId || (nodes[0]?.id || ''));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Archive modal
  const [docToArchive, setDocToArchive] = useState<DocListItemDTO | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const fetchDocs = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nodeId) {
        params.set('nodeId', nodeId);
      } else if (selectedNodeFilter !== 'all') {
        params.set('nodeId', selectedNodeFilter);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/orgs/${orgId}/docs?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to load documents');
      }

      const data = await res.json();
      setDocs(data.docs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [orgId, nodeId, selectedNodeFilter, searchQuery]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDocs();
  };

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const targetNode = selectedNodeId || nodeId;
    if (!targetNode) {
      setCreateError('Please select a team or project node for this document.');
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
          bodyMd: '# ' + newTitle.trim() + '\n\nStart writing...',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to create document');
      }

      const created = await res.json();
      setIsCreateOpen(false);
      setNewTitle('');
      // Navigate to newly created doc
      window.location.href = `/orgs/${orgId}/docs/${created.id}`;
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
        headers: {
          'If-Match': `"v${docToArchive.version}"`,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to archive document');
      }

      setDocs((prev) => prev.filter((d) => d.id !== docToArchive.id));
      setDocToArchive(null);
    } catch (err: any) {
      alert(err.message || 'Failed to archive document');
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Documents Library
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Knowledge base, project specifications, and architectural documentation.
          </p>
        </div>

        {!isViewer && (
          <button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>New Document</span>
          </button>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="p-3 rounded-2xl bg-panel border border-border-subtle flex flex-col sm:flex-row items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 w-full flex items-center gap-2 px-3 py-1.5 rounded-xl bg-panel-inset border border-border-subtle text-xs text-foreground">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents by title or keywords..."
            className="w-full bg-transparent focus:outline-none placeholder:text-muted-foreground text-xs"
          />
          <button type="submit" className="text-[11px] font-semibold text-accent hover:underline">
            Search
          </button>
        </form>

        {!nodeId && nodes.length > 0 && (
          <div className="w-full sm:w-auto shrink-0 flex items-center gap-2">
            <select
              value={selectedNodeFilter}
              onChange={(e) => setSelectedNodeFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-panel-inset border border-border-subtle text-xs text-foreground focus:outline-none focus:border-accent"
            >
              <option value="all">All Teams & Projects</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.kind === 'project' ? '📁 ' : '👥 '}
                  {n.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Content Area */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground">Loading documents...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs">
          {error}
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents found"
          description={
            searchQuery.trim()
              ? "No documents match your search query."
              : "Create your first document to store product specifications, architecture guidelines, and notes."
          }
          action={
            !isViewer
              ? {
                  label: '+ New Document',
                  onClick: () => setIsCreateOpen(true),
                }
              : undefined
          }
        />
      ) : (
        /* Document Cards Grid matching Screenshot 934 */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="p-5 rounded-2xl bg-panel border border-border-subtle hover:border-accent/40 transition-all flex flex-col justify-between space-y-4 shadow-sm group"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-accent/20 text-accent border border-accent/30 shrink-0">
                      v{doc.version}
                    </span>

                    {doc.node && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-panel-inset text-muted-foreground border border-border-subtle truncate">
                        {doc.node.kind === 'project' ? (
                          <FolderGit2 className="w-2.5 h-2.5 text-accent shrink-0" />
                        ) : (
                          <Users className="w-2.5 h-2.5 text-accent shrink-0" />
                        )}
                        <span className="truncate">{doc.node.name}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(doc.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <Link
                  href={`/orgs/${orgId}/docs/${doc.id}`}
                  className="block group-hover:text-accent transition-colors"
                >
                  <h3 className="text-sm font-bold text-foreground leading-snug line-clamp-2">
                    {doc.title}
                  </h3>
                </Link>

                <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                  {doc.excerpt || 'No excerpt available.'}
                </p>
              </div>

              {/* Bottom Card Footer */}
              <div className="pt-3 border-t border-border-subtle flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 truncate pr-2">
                  <div className="w-5 h-5 rounded-full bg-accent/20 text-accent border border-accent/40 flex items-center justify-center font-bold text-[10px] shrink-0">
                    {(doc.updater?.name || 'U').charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate text-[11px]">
                    {doc.updater?.name || 'Unknown'}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/orgs/${orgId}/docs/${doc.id}`}
                    className="px-2.5 py-1 rounded-lg bg-panel-inset hover:bg-panel-elevated border border-border-subtle text-foreground text-xs font-semibold transition-colors"
                  >
                    Open
                  </Link>

                  {!isViewer && (
                    <button
                      onClick={() => setDocToArchive(doc)}
                      className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Archive document"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Document Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-panel border border-border-subtle shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Create New Document</h3>
                <p className="text-xs text-muted-foreground">
                  Initialize an authoritative Markdown document
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateDocument} className="space-y-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Document Title <span className="text-accent">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Architecture Decision Log"
                  className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle focus:border-accent focus:outline-none text-xs text-foreground placeholder:text-muted-foreground"
                />
              </div>

              {!nodeId && nodes.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Target Team or Project <span className="text-accent">*</span>
                  </label>
                  <select
                    value={selectedNodeId}
                    onChange={(e) => setSelectedNodeId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle focus:border-accent focus:outline-none text-xs text-foreground"
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.kind === 'project' ? '📁 Project: ' : '👥 Team: '}
                        {n.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {createError && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-panel-inset hover:bg-panel-elevated border border-border-subtle text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newTitle.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-accent-foreground border-t-transparent rounded-full animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create & Open Editor</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive Document Confirmation Modal */}
      {docToArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-panel border border-border-subtle shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <div className="w-10 h-10 rounded-xl bg-destructive/20 border border-destructive/40 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Archive Document?</h3>
                <p className="text-xs text-muted-foreground">Soft-delete from documents directory</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to archive <strong className="text-foreground">"{docToArchive.title}"</strong>?
              This will remove the document from active listings while preserving its version history.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDocToArchive(null)}
                disabled={isArchiving}
                className="px-4 py-2 rounded-xl bg-panel-inset hover:bg-panel-elevated border border-border-subtle text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchive}
                disabled={isArchiving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive text-white font-bold text-xs shadow-md hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isArchiving ? <span>Archiving...</span> : <span>Archive Document</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
