'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Plus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Layers,
  Lock,
  Globe,
  Move,
  Edit2,
  Trash2,
  Archive,
  Search,
  CheckCircle2,
  AlertCircle,
  UserPlus,
  X,
  Building2,
  ShieldAlert,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

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

export default function TeamsPage() {
  const params = useParams();
  const orgId = params?.orgId as string;

  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Private project members
  const [members, setMembers] = useState<NodeMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState('');
  const [memberActionError, setMemberActionError] = useState<string | null>(null);

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'team' | 'project'>('team');
  const [createName, setCreateName] = useState('');
  const [createParentId, setCreateParentId] = useState<string>('');
  const [createVisibility, setCreateVisibility] = useState<'public' | 'private'>('public');
  const [createDescription, setCreateDescription] = useState('');

  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [moveDestinationId, setMoveDestinationId] = useState<string>('');
  const [moveError, setMoveError] = useState<string | null>(null);

  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [descriptionValue, setDescriptionValue] = useState('');

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [archiveSubtree, setArchiveSubtree] = useState(true);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // 1. Fetch tree from API
  const fetchTree = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/orgs/${orgId}/tree?depth=10`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to load organizational tree');
      }
      const data = await res.json();
      const loadedNodes: TreeNode[] = data.nodes || [];
      setNodes(loadedNodes);

      // Auto-expand all top-level and first child nodes
      const initialExpanded = new Set<string>();
      loadedNodes.forEach((n) => {
        if (!n.parentId || n.depth <= 1) {
          initialExpanded.add(n.id);
        }
      });
      setExpandedNodes(initialExpanded);

      // Select first node if nothing selected
      if (!selectedNodeId && loadedNodes.length > 0) {
        setSelectedNodeId(loadedNodes[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, selectedNodeId]);

  useEffect(() => {
    if (orgId) {
      fetchTree();
    }
  }, [orgId, fetchTree]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0] || null;

  // 2. Fetch members if selected node is a private project
  const fetchMembers = useCallback(async (nodeId: string) => {
    try {
      setLoadingMembers(true);
      setMemberActionError(null);
      const res = await fetch(`/api/orgs/${orgId}/nodes/${nodeId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      } else {
        setMembers([]);
      }
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

  // Expand / collapse tree node
  const toggleExpand = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // Helper: show brief success banner
  const triggerSuccess = (msg: string) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  // 3. Handle Create Node
  const handleCreateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;

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
        const err = await res.json();
        alert(err.message || 'Failed to create node');
        return;
      }

      const created = await res.json();
      setIsCreateOpen(false);
      setCreateName('');
      setCreateDescription('');
      triggerSuccess(`Created ${created.kind} "${created.name}"`);
      await fetchTree();
      setSelectedNodeId(created.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // 4. Handle Rename & Description Update
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || !renameValue.trim()) return;

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
        const err = await res.json();
        alert(err.message || 'Failed to update node');
        return;
      }

      setIsRenameOpen(false);
      triggerSuccess(`Updated "${renameValue.trim()}"`);
      await fetchTree();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // 5. Handle Move Subtree
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
        body: JSON.stringify({
          parentId: targetParentId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMoveError(err.message || 'Failed to move node');
        return;
      }

      setIsMoveOpen(false);
      triggerSuccess(`Relocated "${selectedNode.name}" and subtree`);
      await fetchTree();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    }
  };

  // 6. Handle Delete or Archive
  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode) return;
    setDeleteError(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/nodes/${selectedNode.id}?archive=${archiveSubtree}`, {
        method: 'DELETE',
        headers: {
          'If-Match': `W/"v${selectedNode.version}"`,
        },
      });

      if (!res.ok) {
        const err = await res.json();
        setDeleteError(err.message || 'Failed to delete/archive node');
        return;
      }

      setIsDeleteOpen(false);
      triggerSuccess(archiveSubtree ? `Archived "${selectedNode.name}"` : `Deleted "${selectedNode.name}"`);
      setSelectedNodeId(null);
      await fetchTree();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  };

  // 7. Handle Add Member to Private Project
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || !addMemberEmail.trim()) return;
    setMemberActionError(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/nodes/${selectedNode.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: addMemberEmail.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMemberActionError(err.message || 'Failed to add member');
        return;
      }

      setAddMemberEmail('');
      triggerSuccess('Member added to private project');
      await fetchMembers(selectedNode.id);
    } catch (err) {
      setMemberActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // 8. Handle Remove Member from Private Project
  const handleRemoveMember = async (userId: string) => {
    if (!selectedNode) return;
    if (!confirm('Remove this member from the private project?')) return;

    try {
      const res = await fetch(`/api/orgs/${orgId}/nodes/${selectedNode.id}/members?userId=${userId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.message || 'Failed to remove member');
        return;
      }

      triggerSuccess('Member access revoked');
      await fetchMembers(selectedNode.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Filter nodes matching search query
  const filteredNodes = nodes.filter((n) =>
    n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (n.description && n.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Available parent options (Teams only, excluding the selected node and its descendants for move)
  const availableTeams = nodes.filter((n) => n.kind === 'team');
  const validMoveTargets = availableTeams.filter((t) => {
    if (!selectedNode) return false;
    if (t.id === selectedNode.id) return false;
    // Cannot move beneath its own descendant
    if (t.path === selectedNode.path || t.path.startsWith(`${selectedNode.path}.`)) return false;
    return true;
  });

  // Children of currently selected node
  const childNodes = selectedNode ? nodes.filter((n) => n.parentId === selectedNode.id) : [];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Matching Screenshot 942 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Building2 className="w-6 h-6 text-accent" />
            Teams & Organizational Tree
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Hierarchical departments, nested teams, and project leaves backed by PostgreSQL ltree materialized paths.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => {
              setCreateKind('team');
              setCreateParentId(selectedNode?.kind === 'team' ? selectedNode.id : '');
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-panel-elevated border border-border-subtle text-foreground font-semibold text-xs hover:border-accent hover:text-accent transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Team
          </button>
          <button
            onClick={() => {
              setCreateKind('project');
              setCreateParentId(selectedNode?.kind === 'team' ? selectedNode.id : availableTeams[0]?.id || '');
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {actionSuccess && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs animate-in fade-in duration-150">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs animate-in fade-in duration-150">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Split Directory Layout Matching Screenshot 942 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Hierarchy Panel (Tree Navigator) */}
        <div className="lg:col-span-5 bg-panel border border-border-subtle rounded-2xl overflow-hidden shadow-sm flex flex-col min-h-[500px]">
          {/* Tree Search Bar */}
          <div className="p-3 border-b border-border-subtle bg-panel-inset">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter departments and projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-panel border border-border-subtle rounded-lg text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          {/* Node List View */}
          <div className="p-2 flex-1 overflow-y-auto max-h-[620px] space-y-0.5">
            {loading ? (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
                Loading organizational hierarchy...
              </div>
            ) : filteredNodes.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No matching teams or projects found.
              </div>
            ) : (
              filteredNodes.map((node) => {
                const isSelected = selectedNode?.id === node.id;
                const isExpanded = expandedNodes.has(node.id);
                const hasChildren = nodes.some((child) => child.parentId === node.id);

                return (
                  <div
                    key={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                    style={{ paddingLeft: `${Math.max(node.depth * 14 + 8, 8)}px` }}
                    className={`group flex items-center justify-between py-2 pr-3 rounded-xl cursor-pointer text-xs transition-all ${
                      isSelected
                        ? 'bg-accent/15 text-accent font-semibold border-l-2 border-accent'
                        : 'text-foreground hover:bg-panel-elevated hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {node.kind === 'team' ? (
                        <button
                          type="button"
                          onClick={(e) => toggleExpand(node.id, e)}
                          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {hasChildren ? (
                            isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )
                          ) : (
                            <span className="w-3.5 inline-block" />
                          )}
                        </button>
                      ) : (
                        <span className="w-3.5 inline-block" />
                      )}

                      {node.kind === 'team' ? (
                        isExpanded ? (
                          <FolderOpen className="w-4 h-4 text-accent shrink-0" />
                        ) : (
                          <Folder className="w-4 h-4 text-accent shrink-0" />
                        )
                      ) : (
                        <Layers className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      )}

                      <span className="truncate">{node.name}</span>

                      {node.visibility === 'private' && (
                        <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 opacity-80 group-hover:opacity-100">
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-panel-inset border border-border-subtle text-muted-foreground">
                        {node.kind}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Details Panel */}
        <div className="lg:col-span-7 bg-panel border border-border-subtle rounded-2xl p-6 shadow-sm min-h-[500px]">
          {selectedNode ? (
            <div className="space-y-6">
              {/* Node Title & Action Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-5 border-b border-border-subtle">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="p-2 rounded-xl bg-panel-inset border border-border-subtle text-accent">
                      {selectedNode.kind === 'team' ? (
                        <Folder className="w-5 h-5" />
                      ) : (
                        <Layers className="w-5 h-5" />
                      )}
                    </span>
                    <h2 className="text-xl font-bold text-foreground tracking-tight">
                      {selectedNode.name}
                    </h2>
                    <Badge variant={selectedNode.kind === 'team' ? 'neutral' : 'accent'}>
                      {selectedNode.kind.toUpperCase()}
                    </Badge>
                    <Badge variant={selectedNode.visibility === 'public' ? 'success' : 'warning'}>
                      {selectedNode.visibility === 'public' ? (
                        <span className="inline-flex items-center gap-1">
                          <Globe className="w-3 h-3" /> Public
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Private
                        </span>
                      )}
                    </Badge>
                  </div>

                  {/* Materialized ltree path pill */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                    <span className="text-muted-foreground">ltree path:</span>
                    <span className="px-2 py-0.5 bg-panel-inset rounded border border-border-subtle text-accent/90">
                      {selectedNode.path}
                    </span>
                    <span className="text-muted-foreground">(v{selectedNode.version})</span>
                  </div>
                </div>

                {/* Operations Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      setRenameValue(selectedNode.name);
                      setDescriptionValue(selectedNode.description || '');
                      setIsRenameOpen(true);
                    }}
                    className="p-2 rounded-xl bg-panel-elevated border border-border-subtle text-foreground hover:border-accent hover:text-accent transition-colors"
                    title="Rename / Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => {
                      setMoveDestinationId(selectedNode.parentId || 'ROOT');
                      setMoveError(null);
                      setIsMoveOpen(true);
                    }}
                    className="p-2 rounded-xl bg-panel-elevated border border-border-subtle text-foreground hover:border-accent hover:text-accent transition-colors"
                    title="Move Subtree"
                  >
                    <Move className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => {
                      setDeleteError(null);
                      setIsDeleteOpen(true);
                    }}
                    className="p-2 rounded-xl bg-panel-elevated border border-border-subtle text-rose-400 hover:border-rose-500 hover:text-rose-500 transition-colors"
                    title="Archive / Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Description */}
              <div className="p-4 bg-panel-inset border border-border-subtle rounded-xl text-xs text-muted-foreground leading-relaxed">
                {selectedNode.description || (
                  <span className="italic text-muted-foreground/60">No description provided for this node.</span>
                )}
              </div>

              {/* If Team: List of Children */}
              {selectedNode.kind === 'team' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Sub-teams & Projects ({childNodes.length})
                    </h3>
                    <button
                      onClick={() => {
                        setCreateParentId(selectedNode.id);
                        setIsCreateOpen(true);
                      }}
                      className="text-xs text-accent hover:underline inline-flex items-center gap-1 font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add child
                    </button>
                  </div>

                  {childNodes.length === 0 ? (
                    <div className="p-6 text-center border border-dashed border-border-subtle rounded-xl text-xs text-muted-foreground">
                      This team currently has no child nodes.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {childNodes.map((child) => (
                        <div
                          key={child.id}
                          onClick={() => setSelectedNodeId(child.id)}
                          className="p-3 bg-panel-inset hover:bg-panel-elevated border border-border-subtle rounded-xl cursor-pointer transition-colors space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                              {child.kind === 'team' ? (
                                <Folder className="w-3.5 h-3.5 text-accent" />
                              ) : (
                                <Layers className="w-3.5 h-3.5 text-purple-400" />
                              )}
                              {child.name}
                            </span>
                            <Badge variant={child.kind === 'team' ? 'neutral' : 'accent'}>
                              {child.kind}
                            </Badge>
                          </div>
                          {child.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-1">
                              {child.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* If Private Project: Manage Member Access */}
              {selectedNode.kind === 'project' && selectedNode.visibility === 'private' && (
                <div className="space-y-4 pt-2 border-t border-border-subtle">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                        Private Project Members ({members.length})
                      </h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Only enrolled members and organization Owners/Admins can view this project.
                      </p>
                    </div>
                  </div>

                  {/* Add Member Form */}
                  <form onSubmit={handleAddMember} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Enter user UUID to grant access..."
                      value={addMemberEmail}
                      onChange={(e) => setAddMemberEmail(e.target.value)}
                      className="flex-1 px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={!addMemberEmail.trim()}
                      className="px-3 py-2 bg-accent text-accent-foreground font-bold text-xs rounded-xl disabled:opacity-50 hover:opacity-90 transition-opacity inline-flex items-center gap-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Add Member
                    </button>
                  </form>

                  {memberActionError && (
                    <p className="text-xs text-rose-400">{memberActionError}</p>
                  )}

                  {/* Members list */}
                  <div className="divide-y divide-border-subtle border border-border-subtle rounded-xl overflow-hidden bg-panel-inset">
                    {loadingMembers ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        Loading member permissions...
                      </div>
                    ) : members.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        No explicit members enrolled.
                      </div>
                    ) : (
                      members.map((m) => (
                        <div key={m.userId} className="flex items-center justify-between p-3 text-xs">
                          <div>
                            <span className="font-semibold text-foreground">{m.name || m.email}</span>
                            <span className="ml-2 text-muted-foreground font-mono text-[11px]">{m.email}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveMember(m.userId)}
                            className="p-1 text-muted-foreground hover:text-rose-400 rounded transition-colors"
                            title="Revoke access"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground p-12 text-center">
              Select a node from the tree hierarchy on the left to inspect its properties.
            </div>
          )}
        </div>
      </div>

      {/* 1. Modal: Create Node */}
      <Dialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title={createKind === 'team' ? 'Create New Team' : 'Create New Project'}
        description="Expand your organizational structure with teams and leaf projects."
      >
        <form onSubmit={handleCreateNode} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Node Kind
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCreateKind('team')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                  createKind === 'team'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-subtle bg-panel-inset text-muted-foreground hover:text-foreground'
                }`}
              >
                <Folder className="w-3.5 h-3.5" /> Team Container
              </button>
              <button
                type="button"
                onClick={() => setCreateKind('project')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                  createKind === 'project'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-subtle bg-panel-inset text-muted-foreground hover:text-foreground'
                }`}
              >
                <Layers className="w-3.5 h-3.5" /> Project Leaf
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Name *
            </label>
            <input
              type="text"
              required
              placeholder={createKind === 'team' ? 'e.g. Infrastructure' : 'e.g. Cloud Migration'}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Parent Team {createKind === 'project' ? '(Required)' : '(Optional for Root Team)'}
            </label>
            <select
              value={createParentId}
              onChange={(e) => setCreateParentId(e.target.value)}
              required={createKind === 'project'}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent"
            >
              {createKind === 'team' && <option value="">Root Level (No Parent)</option>}
              {availableTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.path})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Visibility
            </label>
            <select
              value={createVisibility}
              onChange={(e) => setCreateVisibility(e.target.value as 'public' | 'private')}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent"
            >
              <option value="public">Public (Visible to organization)</option>
              <option value="private">Private (Restricted to assigned members)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Description (Optional)
            </label>
            <textarea
              rows={3}
              placeholder="Summary of scope, purpose, or objectives..."
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="px-4 py-2 rounded-xl border border-border-subtle text-xs text-muted-foreground hover:text-foreground hover:bg-panel-elevated"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs hover:opacity-90 transition-opacity"
            >
              Create {createKind}
            </button>
          </div>
        </form>
      </Dialog>

      {/* 2. Modal: Move Subtree */}
      <Dialog
        isOpen={isMoveOpen}
        onClose={() => setIsMoveOpen(false)}
        title={`Move Subtree: "${selectedNode?.name}"`}
        description="Relocate this node and all of its descendants to a new parent in an atomic transaction."
      >
        <form onSubmit={handleMove} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Select Destination Parent
            </label>
            <select
              value={moveDestinationId}
              onChange={(e) => setMoveDestinationId(e.target.value)}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent"
            >
              {selectedNode?.kind === 'team' && (
                <option value="ROOT">Root Level (No Parent)</option>
              )}
              {validMoveTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.path})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Hierarchy cycle prevention: nodes cannot be moved beneath their own descendants.
            </p>
          </div>

          {moveError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{moveError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => setIsMoveOpen(false)}
              className="px-4 py-2 rounded-xl border border-border-subtle text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
            >
              <Move className="w-3.5 h-3.5" />
              Confirm Relocation
            </button>
          </div>
        </form>
      </Dialog>

      {/* 3. Modal: Rename / Edit Node */}
      <Dialog
        isOpen={isRenameOpen}
        onClose={() => setIsRenameOpen(false)}
        title={`Edit "${selectedNode?.name}"`}
        description="Update node display name and description without rewriting descendant paths."
      >
        <form onSubmit={handleRename} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Display Name *
            </label>
            <input
              type="text"
              required
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Description
            </label>
            <textarea
              rows={3}
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.target.value)}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => setIsRenameOpen(false)}
              className="px-4 py-2 rounded-xl border border-border-subtle text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs hover:opacity-90 transition-opacity"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Dialog>

      {/* 4. Modal: Delete / Archive Node */}
      <Dialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        title={`Archive or Delete "${selectedNode?.name}"`}
        description="Non-empty teams and projects containing active tasks require archiving rather than permanent deletion."
      >
        <form onSubmit={handleDelete} className="space-y-4">
          <div className="p-3 bg-panel-inset border border-border-subtle rounded-xl text-xs space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="deleteMode"
                checked={archiveSubtree}
                onChange={() => setArchiveSubtree(true)}
                className="mt-0.5"
              />
              <div>
                <span className="font-semibold text-foreground flex items-center gap-1">
                  <Archive className="w-3.5 h-3.5 text-accent" /> Archive Subtree (Recommended)
                </span>
                <span className="text-muted-foreground block text-[11px] mt-0.5">
                  Safely hides the node and all of its descendants while preserving historical task records.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-border-subtle">
              <input
                type="radio"
                name="deleteMode"
                checked={!archiveSubtree}
                onChange={() => setArchiveSubtree(false)}
                className="mt-0.5"
              />
              <div>
                <span className="font-semibold text-rose-400 flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" /> Permanent Delete (Empty Leaf Only)
                </span>
                <span className="text-muted-foreground block text-[11px] mt-0.5">
                  Only permitted if the node has zero children and zero tasks, documents, or meetings.
                </span>
              </div>
            </label>
          </div>

          {deleteError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{deleteError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => setIsDeleteOpen(false)}
              className="px-4 py-2 rounded-xl border border-border-subtle text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-rose-500 text-white font-bold text-xs hover:bg-rose-600 transition-colors"
            >
              Confirm {archiveSubtree ? 'Archive' : 'Delete'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
