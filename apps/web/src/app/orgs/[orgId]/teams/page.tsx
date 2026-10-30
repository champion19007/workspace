'use client';

import React, { useState, useEffect, useCallback, useId, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Plus,
  Folder,
  FolderKanban,
  ChevronRight,
  Lock,
  Pencil,
  FolderInput,
  Archive,
  Search,
  UserPlus,
  X,
  Users,
  ArrowRight,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, EmptyState, ErrorState } from '@/components/ui/states';
import { useShell } from '@/components/shell/shell-context';

interface TreeNode {
  id: string;
  orgId: string;
  parentId: string | null;
  kind: 'team' | 'project';
  name: string;
  description: string | null;
  path: string;
  visibility: 'public' | 'private';
  version: number;
  depth: number;
}

interface NodeMember {
  userId: string;
  email: string;
  name: string | null;
  role: string;
}

interface OrgMember {
  id: string;
  name: string | null;
  email: string;
}

/** Teams first, then projects, each alphabetical. */
const byKindThenName = (a: TreeNode, b: TreeNode) =>
  a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'team' ? -1 : 1;

export default function TeamsPage() {
  const params = useParams();
  const orgId = params?.orgId as string;
  const { refreshProjects } = useShell();
  const ids = useId();

  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Private project members
  const [members, setMembers] = useState<NodeMember[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberToAdd, setMemberToAdd] = useState('');
  const [memberActionError, setMemberActionError] = useState<string | null>(null);

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'team' | 'project'>('team');
  const [createName, setCreateName] = useState('');
  const [createParentId, setCreateParentId] = useState<string>('');
  const [createVisibility, setCreateVisibility] = useState<'public' | 'private'>('public');
  const [createDescription, setCreateDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [moveDestinationId, setMoveDestinationId] = useState<string>('');
  const [moveError, setMoveError] = useState<string | null>(null);

  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [descriptionValue, setDescriptionValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [archiveSubtree, setArchiveSubtree] = useState(true);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/orgs/${orgId}/tree?depth=10`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Teams couldn't be loaded.");
      }
      const data = await res.json();
      const loadedNodes: TreeNode[] = data.nodes || [];
      setNodes(loadedNodes);
      setSelectedNodeId((current) => current ?? loadedNodes.filter((n) => !n.parentId).sort(byKindThenName)[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (orgId) fetchTree();
  }, [orgId, fetchTree]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  const fetchMembers = useCallback(async (nodeId: string) => {
    try {
      setLoadingMembers(true);
      setMemberActionError(null);
      const [res, orgRes] = await Promise.all([fetch(`/api/orgs/${orgId}/nodes/${nodeId}/members`), fetch(`/api/orgs/${orgId}/members`)]);
      setMembers(res.ok ? ((await res.json()).members ?? []) : []);
      setOrgMembers(orgRes.ok ? ((await orgRes.json()).members ?? []) : []);
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (selectedNode && selectedNode.kind === 'project' && selectedNode.visibility === 'private') {
      fetchMembers(selectedNode.id);
    } else {
      setMembers([]);
    }
  }, [selectedNode, fetchMembers]);

  const childrenOf = useMemo(() => {
    const known = new Set(nodes.map((n) => n.id));
    const map = new Map<string | null, TreeNode[]>();
    for (const n of nodes) {
      // A node whose parent isn't visible to this user is shown at the top level.
      const parent = n.parentId && known.has(n.parentId) ? n.parentId : null;
      map.set(parent, [...(map.get(parent) ?? []), n]);
    }
    for (const list of map.values()) list.sort(byKindThenName);
    return map;
  }, [nodes]);

  const toggleCollapsed = (nodeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const triggerSuccess = (msg: string) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const openCreate = (kind: 'team' | 'project', parentId: string) => {
    setCreateKind(kind);
    setCreateParentId(parentId);
    setCreateName('');
    setCreateDescription('');
    setCreateVisibility('public');
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleCreateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreateError(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          kind: createKind,
          parentId: createParentId || null,
          visibility: createVisibility,
          description: createDescription.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setCreateError(err.message || `The ${createKind} couldn't be created.`);
        return;
      }

      const created = await res.json();
      setIsCreateOpen(false);
      triggerSuccess(`Created ${created.kind} “${created.name}”`);
      if (created.kind === 'project') refreshProjects();
      await fetchTree();
      setSelectedNodeId(created.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || !renameValue.trim()) return;
    setRenameError(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/nodes/${selectedNode.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"v${selectedNode.version}"`,
        },
        body: JSON.stringify({
          name: renameValue.trim(),
          description: descriptionValue.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setRenameError(err.message || "Your changes couldn't be saved.");
        return;
      }

      setIsRenameOpen(false);
      triggerSuccess(`Saved “${renameValue.trim()}”`);
      if (selectedNode.kind === 'project') refreshProjects();
      await fetchTree();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode) return;
    setMoveError(null);

    const targetParentId = moveDestinationId === 'ROOT' ? null : moveDestinationId;

    try {
      const res = await fetch(`/api/orgs/${orgId}/nodes/${selectedNode.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"v${selectedNode.version}"`,
        },
        body: JSON.stringify({ parentId: targetParentId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMoveError(err.message || `“${selectedNode.name}” couldn't be moved.`);
        return;
      }

      setIsMoveOpen(false);
      triggerSuccess(`Moved “${selectedNode.name}”`);
      refreshProjects();
      await fetchTree();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode) return;
    setDeleteError(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/nodes/${selectedNode.id}?archive=${archiveSubtree}`, {
        method: 'DELETE',
        headers: { 'If-Match': `W/"v${selectedNode.version}"` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDeleteError(err.message || `“${selectedNode.name}” couldn't be removed.`);
        return;
      }

      setIsDeleteOpen(false);
      triggerSuccess(archiveSubtree ? `Archived “${selectedNode.name}”` : `Deleted “${selectedNode.name}”`);
      setSelectedNodeId(null);
      refreshProjects();
      await fetchTree();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || !memberToAdd) return;
    setMemberActionError(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/nodes/${selectedNode.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: memberToAdd }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMemberActionError(err.message || "That person couldn't be added.");
        return;
      }

      setMemberToAdd('');
      triggerSuccess('Member added');
      await fetchMembers(selectedNode.id);
    } catch (err) {
      setMemberActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveMember = async (member: NodeMember) => {
    if (!selectedNode) return;
    if (!confirm(`Remove ${member.name || member.email} from “${selectedNode.name}”?`)) return;
    setMemberActionError(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/nodes/${selectedNode.id}/members?userId=${member.userId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMemberActionError(err.message || "That person couldn't be removed.");
        return;
      }

      triggerSuccess('Access removed');
      await fetchMembers(selectedNode.id);
    } catch (err) {
      setMemberActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const searchResults = q
    ? nodes.filter((n) => n.name.toLowerCase().includes(q) || (n.description ?? '').toLowerCase().includes(q)).sort(byKindThenName)
    : null;

  const availableTeams = nodes.filter((n) => n.kind === 'team').sort(byKindThenName);
  const validMoveTargets = availableTeams.filter((t) => {
    if (!selectedNode) return false;
    if (t.id === selectedNode.id) return false;
    // Cannot move beneath its own descendant
    if (t.path === selectedNode.path || t.path.startsWith(`${selectedNode.path}.`)) return false;
    return true;
  });
  const childNodes = selectedNode ? (childrenOf.get(selectedNode.id) ?? []) : [];
  const parentName = (id: string | null) => nodes.find((n) => n.id === id)?.name;
  const addableMembers = orgMembers.filter((m) => !members.some((pm) => pm.userId === m.id));

  const renderRow = (node: TreeNode, level: number, showParent = false) => {
    const isSelected = selectedNode?.id === node.id;
    const kids = childrenOf.get(node.id) ?? [];
    const isOpen = !collapsed.has(node.id);
    const Icon = node.kind === 'team' ? Folder : FolderKanban;
    return (
      <div
        className={`group flex items-center gap-1 rounded-md pr-2 text-sm transition-colors ${
          isSelected ? 'bg-accent-subtle text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
        }`}
        style={{ paddingLeft: `${4 + level * 16}px` }}
      >
        {kids.length > 0 && !showParent ? (
          <button
            type="button"
            onClick={() => toggleCollapsed(node.id)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
            className="rounded p-1 text-fg-subtle hover:text-fg"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
          </button>
        ) : (
          <span className="w-[22px] shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => setSelectedNodeId(node.id)}
          aria-current={isSelected ? 'true' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <Icon className={`h-4 w-4 shrink-0 ${isSelected ? 'text-accent-text' : 'text-fg-subtle'}`} aria-hidden="true" />
          <span className={`truncate ${isSelected ? 'font-medium' : ''}`}>{node.name}</span>
          {node.visibility === 'private' && <Lock className="h-3 w-3 shrink-0 text-fg-subtle" aria-label="Private" />}
          {showParent && node.parentId && <span className="truncate text-xs text-fg-subtle">in {parentName(node.parentId)}</span>}
        </button>
      </div>
    );
  };

  const renderTree = (parentId: string | null, level: number): React.ReactNode => {
    const list = childrenOf.get(parentId) ?? [];
    if (list.length === 0) return null;
    return (
      <ul className="space-y-0.5">
        {list.map((node) => (
          <li key={node.id}>
            {renderRow(node, level)}
            {!collapsed.has(node.id) && renderTree(node.id, level + 1)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        description="How your organization is structured. Teams can hold sub-teams and projects."
        actions={
          <>
            <button
              type="button"
              onClick={() => openCreate('team', selectedNode?.kind === 'team' ? selectedNode.id : '')}
              className="btn btn-secondary"
            >
              <Plus aria-hidden="true" />
              New team
            </button>
            <button
              type="button"
              onClick={() =>
                openCreate('project', selectedNode?.kind === 'team' ? selectedNode.id : selectedNode?.parentId || availableTeams[0]?.id || '')
              }
              disabled={availableTeams.length === 0}
              className="btn btn-primary"
            >
              <Plus aria-hidden="true" />
              New project
            </button>
          </>
        }
      />

      {actionSuccess && <Alert tone="success">{actionSuccess}</Alert>}

      {loading && nodes.length === 0 ? (
        <div className="grid gap-6 lg:grid-cols-12" aria-hidden="true">
          <div className="card h-80 lg:col-span-5" />
          <div className="card h-80 lg:col-span-7" />
        </div>
      ) : error ? (
        <ErrorState title="Couldn't load teams" message={error} onRetry={fetchTree} />
      ) : nodes.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No teams yet"
          description="Create a team for each group that works together, then add projects inside it."
          action={{ label: 'New team', onClick: () => openCreate('team', ''), primary: true }}
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-12">
          <nav aria-label="Teams and projects" className="card flex flex-col overflow-hidden lg:col-span-5">
            <div className="border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Filter teams and projects"
                  aria-label="Filter teams and projects"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="field field-sm pl-9"
                />
              </div>
            </div>
            <div className="max-h-[36rem] overflow-y-auto p-2">
              {searchResults ? (
                searchResults.length === 0 ? (
                  <p className="p-6 text-center text-sm text-fg-muted">Nothing matches “{searchQuery}”.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {searchResults.map((node) => (
                      <li key={node.id}>{renderRow(node, 0, true)}</li>
                    ))}
                  </ul>
                )
              ) : (
                renderTree(null, 0)
              )}
            </div>
          </nav>

          <section aria-label="Details" className="card min-h-[20rem] p-5 lg:col-span-7">
            {selectedNode ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-tight text-fg">{selectedNode.name}</h2>
                      <Badge variant={selectedNode.kind === 'team' ? 'neutral' : 'accent'} icon={selectedNode.kind === 'team' ? Folder : FolderKanban}>
                        {selectedNode.kind === 'team' ? 'Team' : 'Project'}
                      </Badge>
                      {selectedNode.visibility === 'private' && <Badge icon={Lock}>Private</Badge>}
                    </div>
                    {selectedNode.parentId && <p className="text-sm text-fg-muted">In {parentName(selectedNode.parentId) ?? 'a team'}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRenameValue(selectedNode.name);
                        setDescriptionValue(selectedNode.description || '');
                        setRenameError(null);
                        setIsRenameOpen(true);
                      }}
                      className="btn btn-ghost btn-icon btn-sm"
                      aria-label={`Edit ${selectedNode.name}`}
                      title="Edit"
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoveDestinationId(selectedNode.parentId || (selectedNode.kind === 'team' ? 'ROOT' : validMoveTargets[0]?.id || ''));
                        setMoveError(null);
                        setIsMoveOpen(true);
                      }}
                      className="btn btn-ghost btn-icon btn-sm"
                      aria-label={`Move ${selectedNode.name}`}
                      title="Move"
                    >
                      <FolderInput aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setArchiveSubtree(true);
                        setIsDeleteOpen(true);
                      }}
                      className="btn btn-ghost btn-icon btn-sm hover:text-danger"
                      aria-label={`Archive or delete ${selectedNode.name}`}
                      title="Archive or delete"
                    >
                      <Archive aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <p className={`text-sm ${selectedNode.description ? 'text-fg' : 'italic text-fg-subtle'}`}>
                  {selectedNode.description || 'No description yet.'}
                </p>

                {selectedNode.kind === 'project' && (
                  <Link href={`/orgs/${orgId}/projects/${selectedNode.id}/dashboard`} className="btn btn-secondary btn-sm">
                    Open project
                    <ArrowRight aria-hidden="true" />
                  </Link>
                )}

                {selectedNode.kind === 'team' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-fg">
                        Inside this team <span className="font-normal text-fg-muted">{childNodes.length}</span>
                      </h3>
                      <button type="button" onClick={() => openCreate('project', selectedNode.id)} className="btn btn-ghost btn-sm">
                        <Plus aria-hidden="true" />
                        Add project
                      </button>
                    </div>

                    {childNodes.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-fg-muted">
                        No sub-teams or projects yet.
                      </p>
                    ) : (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {childNodes.map((child) => {
                          const Icon = child.kind === 'team' ? Folder : FolderKanban;
                          return (
                            <li key={child.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedNodeId(child.id)}
                                className="flex h-full w-full flex-col gap-1 rounded-lg border border-border p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2/60"
                              >
                                <span className="flex items-center gap-2 font-medium text-fg">
                                  <Icon className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                                  {child.name}
                                </span>
                                {child.description && <span className="line-clamp-1 text-xs text-fg-muted">{child.description}</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {selectedNode.kind === 'project' && selectedNode.visibility === 'private' && (
                  <div className="space-y-3 border-t border-border pt-5">
                    <div>
                      <h3 className="text-sm font-semibold text-fg">
                        Members <span className="font-normal text-fg-muted">{members.length}</span>
                      </h3>
                      <p className="text-xs text-fg-muted">Only these people, plus organization owners and admins, can see this project.</p>
                    </div>

                    <form onSubmit={handleAddMember} className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={memberToAdd}
                        onChange={(e) => setMemberToAdd(e.target.value)}
                        aria-label="Person to add"
                        className="field field-sm flex-1"
                      >
                        <option value="">Choose a person</option>
                        {addableMembers.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.email}
                          </option>
                        ))}
                      </select>
                      <button type="submit" disabled={!memberToAdd} className="btn btn-primary btn-sm">
                        <UserPlus aria-hidden="true" />
                        Add
                      </button>
                    </form>

                    {memberActionError && <Alert onDismiss={() => setMemberActionError(null)}>{memberActionError}</Alert>}

                    {loadingMembers ? (
                      <div className="skeleton h-12 w-full" aria-hidden="true" />
                    ) : members.length === 0 ? (
                      <p className="text-sm text-fg-muted">No one has been added yet.</p>
                    ) : (
                      <ul className="card divide-y divide-border overflow-hidden">
                        {members.map((m) => (
                          <li key={m.userId} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                            <Avatar name={m.name || m.email} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-fg">{m.name || m.email}</p>
                              <p className="truncate text-xs text-fg-muted">{m.email}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(m)}
                              className="btn btn-ghost btn-icon btn-sm hover:text-danger"
                              aria-label={`Remove ${m.name || m.email}`}
                              title="Remove access"
                            >
                              <X aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-[16rem] items-center justify-center text-center text-sm text-fg-muted">
                Choose a team or project to see its details.
              </div>
            )}
          </section>
        </div>
      )}

      <Dialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title={createKind === 'team' ? 'New team' : 'New project'}
        description={createKind === 'team' ? 'A team can contain sub-teams and projects.' : 'A project lives inside a team and holds tasks, docs and meetings.'}
      >
        <form onSubmit={handleCreateNode} className="space-y-4">
          {createError && <Alert>{createError}</Alert>}

          <div role="group" aria-label="Type" className="segmented w-full">
            <button type="button" aria-pressed={createKind === 'team'} onClick={() => setCreateKind('team')} className="flex-1 justify-center">
              <Folder className="h-4 w-4" aria-hidden="true" /> Team
            </button>
            <button
              type="button"
              aria-pressed={createKind === 'project'}
              onClick={() => {
                setCreateKind('project');
                if (!createParentId) setCreateParentId(availableTeams[0]?.id ?? '');
              }}
              disabled={availableTeams.length === 0}
              className="flex-1 justify-center"
            >
              <FolderKanban className="h-4 w-4" aria-hidden="true" /> Project
            </button>
          </div>

          <div>
            <label htmlFor={`${ids}-name`} className="label">
              Name
            </label>
            <input
              id={`${ids}-name`}
              type="text"
              required
              placeholder={createKind === 'team' ? 'e.g. Platform' : 'e.g. Cloud migration'}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <label htmlFor={`${ids}-parent`} className="label">
              {createKind === 'project' ? 'Team' : 'Parent team'}
            </label>
            <select
              id={`${ids}-parent`}
              value={createParentId}
              onChange={(e) => setCreateParentId(e.target.value)}
              required={createKind === 'project'}
              className="field"
            >
              {createKind === 'team' && <option value="">None (top level)</option>}
              {availableTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${ids}-visibility`} className="label">
              Who can see it
            </label>
            <select
              id={`${ids}-visibility`}
              value={createVisibility}
              onChange={(e) => setCreateVisibility(e.target.value as 'public' | 'private')}
              className="field"
            >
              <option value="public">Everyone in the organization</option>
              <option value="private">Members only (plus owners and admins)</option>
            </select>
          </div>

          <div>
            <label htmlFor={`${ids}-desc`} className="label">
              Description <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <textarea
              id={`${ids}-desc`}
              rows={3}
              placeholder="What is it for?"
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              className="field resize-y"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setIsCreateOpen(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create {createKind}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        isOpen={isMoveOpen}
        onClose={() => setIsMoveOpen(false)}
        title={`Move “${selectedNode?.name ?? ''}”`}
        description="Everything inside it moves too."
      >
        <form onSubmit={handleMove} className="space-y-4">
          <div>
            <label htmlFor={`${ids}-move`} className="label">
              New parent team
            </label>
            <select id={`${ids}-move`} value={moveDestinationId} onChange={(e) => setMoveDestinationId(e.target.value)} className="field">
              {selectedNode?.kind === 'team' && <option value="ROOT">None (top level)</option>}
              {validMoveTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="hint mt-1.5">A team can't be moved inside one of its own sub-teams.</p>
          </div>

          {moveError && <Alert>{moveError}</Alert>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setIsMoveOpen(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Move
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog isOpen={isRenameOpen} onClose={() => setIsRenameOpen(false)} title={`Edit “${selectedNode?.name ?? ''}”`}>
        <form onSubmit={handleRename} className="space-y-4">
          {renameError && <Alert>{renameError}</Alert>}
          <div>
            <label htmlFor={`${ids}-rename`} className="label">
              Name
            </label>
            <input id={`${ids}-rename`} type="text" required value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="field" />
          </div>

          <div>
            <label htmlFor={`${ids}-redesc`} className="label">
              Description
            </label>
            <textarea id={`${ids}-redesc`} rows={3} value={descriptionValue} onChange={(e) => setDescriptionValue(e.target.value)} className="field resize-y" />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setIsRenameOpen(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        title={`Remove “${selectedNode?.name ?? ''}”?`}
        description="Teams and projects that still hold work can only be archived."
      >
        <form onSubmit={handleDelete} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="sr-only">How to remove it</legend>
            <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 ${archiveSubtree ? 'border-accent bg-accent-subtle' : 'border-border-strong'}`}>
              <input type="radio" name="deleteMode" checked={archiveSubtree} onChange={() => setArchiveSubtree(true)} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-fg">Archive (recommended)</span>
                <span className="block text-xs text-fg-muted">Hides it and everything inside. Tasks and history are kept.</span>
              </span>
            </label>
            <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 ${!archiveSubtree ? 'border-danger bg-danger-subtle' : 'border-border-strong'}`}>
              <input type="radio" name="deleteMode" checked={!archiveSubtree} onChange={() => setArchiveSubtree(false)} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-fg">Delete for good</span>
                <span className="block text-xs text-fg-muted">Only possible when it's empty: no sub-teams, tasks, docs or meetings.</span>
              </span>
            </label>
          </fieldset>

          {deleteError && <Alert>{deleteError}</Alert>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setIsDeleteOpen(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" className={archiveSubtree ? 'btn btn-primary' : 'btn btn-danger'}>
              {archiveSubtree ? 'Archive' : 'Delete'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
