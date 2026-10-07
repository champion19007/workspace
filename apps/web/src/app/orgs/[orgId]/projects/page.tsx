'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Search,
  Plus,
  Layers,
  Lock,
  Globe,
  Folder,
  Users,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/table-shell';

interface ProjectItem {
  id: string;
  name: string;
  description: string | null;
  path: string;
  visibility: 'public' | 'private';
  version: number;
  parentId: string | null;
  teamName: string | null;
  memberCount: number;
}

interface TeamOption {
  id: string;
  name: string;
  path: string;
}

export default function ProjectsPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params?.orgId as string;

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal: Create Project
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const [newVisibility, setNewVisibility] = useState<'public' | 'private'>('public');
  const [newDesc, setNewDesc] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // 1. Fetch projects and teams
  const fetchProjectsAndTeams = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load teams for filtering and creation
      const treeRes = await fetch(`/api/orgs/${orgId}/tree?depth=10`);
      if (treeRes.ok) {
        const treeData = await treeRes.json();
        const availableTeams: TeamOption[] = (treeData.nodes || [])
          .filter((n: { kind: string }) => n.kind === 'team')
          .map((n: { id: string; name: string; path: string }) => ({
            id: n.id,
            name: n.name,
            path: n.path,
          }));
        setTeams(availableTeams);
        if (availableTeams.length > 0 && !newParentId) {
          setNewParentId(availableTeams[0].id);
        }
      }

      // Load projects
      const teamQuery = selectedTeamFilter !== 'ALL' ? `&teamId=${selectedTeamFilter}` : '';
      const projRes = await fetch(`/api/orgs/${orgId}/projects?limit=100${teamQuery}`);
      if (!projRes.ok) {
        const err = await projRes.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to load projects');
      }
      const projData = await projRes.json();
      setProjects(projData.projects || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, selectedTeamFilter, newParentId]);

  useEffect(() => {
    if (orgId) {
      fetchProjectsAndTeams();
    }
  }, [orgId, selectedTeamFilter, fetchProjectsAndTeams]);

  // 2. Handle Create Project
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newParentId) {
      setCreateError('Project name and parent team are required.');
      return;
    }

    try {
      setCreateError(null);
      const res = await fetch(`/api/orgs/${orgId}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          kind: 'project',
          parentId: newParentId,
          visibility: newVisibility,
          description: newDesc.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setCreateError(err.message || 'Failed to create project');
        return;
      }

      const created = await res.json();
      setIsModalOpen(false);
      setNewName('');
      setNewDesc('');
      triggerSuccess(`Project "${created.name}" created successfully`);
      await fetchProjectsAndTeams();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  // Client search filtering
  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.teamName && p.teamName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Matching Screenshot 941 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6 text-accent" />
            Projects Directory
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            All leaf projects across organizational teams. Projects own tasks, documents, and meeting action items.
          </p>
        </div>

        <button
          onClick={() => {
            setCreateError(null);
            setIsModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          New Project
        </button>
      </div>

      {/* Success Notification Banner */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search & Team Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-panel border border-border-subtle rounded-2xl">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects by name, description, or team..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Team Scope:</span>
            <select
              value={selectedTeamFilter}
              onChange={(e) => setSelectedTeamFilter(e.target.value)}
              className="px-3 py-1.5 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent"
            >
              <option value="ALL">All Departments</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <Badge variant="neutral">
            {filteredProjects.length} {filteredProjects.length === 1 ? 'project' : 'projects'}
          </Badge>
        </div>
      </div>

      {/* Project Card Grid Matching Screenshot 941 */}
      {loading ? (
        <div className="p-12 text-center text-xs text-muted-foreground animate-pulse">
          Loading organization projects...
        </div>
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No projects found"
          description={
            teams.length === 0
              ? 'To create projects, your organization needs at least one team container first.'
              : 'Try adjusting your search terms or create a new project.'
          }
          action={{
            label: teams.length > 0 ? '+ New Project' : 'Go to Teams',
            onClick: () => {
              if (teams.length > 0) {
                setIsModalOpen(true);
              } else {
                router.push(`/orgs/${orgId}/teams`);
              }
            },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/orgs/${orgId}/projects/${p.id}/tasks`)}
              className="group p-5 bg-panel hover:bg-panel-elevated border border-border-subtle hover:border-accent/40 rounded-2xl cursor-pointer transition-all shadow-sm flex flex-col justify-between space-y-4"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="p-2 rounded-xl bg-panel-inset border border-border-subtle text-accent group-hover:scale-105 transition-transform">
                      <Layers className="w-4 h-4" />
                    </span>
                    <div>
                      <h3 className="font-bold text-sm text-foreground group-hover:text-accent transition-colors line-clamp-1">
                        {p.name}
                      </h3>
                      {p.teamName && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Folder className="w-3 h-3 text-accent/80" />
                          <span>{p.teamName}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <Badge variant={p.visibility === 'public' ? 'success' : 'warning'}>
                    {p.visibility === 'public' ? (
                      <span className="inline-flex items-center gap-1 text-[10px]">
                        <Globe className="w-2.5 h-2.5" /> Public
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px]">
                        <Lock className="w-2.5 h-2.5" /> Private
                      </span>
                    )}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {p.description || 'No description provided.'}
                </p>
              </div>

              <div className="pt-3 border-t border-border-subtle flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  {p.visibility === 'private' && (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                      <Users className="w-3 h-3 text-amber-400" />
                      {p.memberCount} members
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground/80 px-1.5 py-0.5 rounded bg-panel-inset">
                    v{p.version}
                  </span>
                </div>

                <span className="text-accent text-xs font-semibold inline-flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  View tasks <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Create Project */}
      <Dialog
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Project"
        description="Projects reside within a team container and own tasks, documents, and meeting action items."
      >
        <form onSubmit={handleCreateProject} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Project Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Infrastructure Modernization"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Parent Team * (Projects are leaves under teams)
            </label>
            {teams.length === 0 ? (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs">
                No teams found. Please create a team first before adding projects.
              </div>
            ) : (
              <select
                value={newParentId}
                onChange={(e) => setNewParentId(e.target.value)}
                required
                className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent"
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.path})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Visibility
            </label>
            <select
              value={newVisibility}
              onChange={(e) => setNewVisibility(e.target.value as 'public' | 'private')}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent"
            >
              <option value="public">Public (Visible to all organization members)</option>
              <option value="private">Private (Restricted to creator and assigned members)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Description (Optional)
            </label>
            <textarea
              rows={3}
              placeholder="Summary of project goals, roadmap, or requirements..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full px-3 py-2 bg-panel-inset border border-border-subtle rounded-xl text-xs text-foreground focus:outline-none focus:border-accent resize-none"
            />
          </div>

          {createError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{createError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-border-subtle text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={teams.length === 0}
              className="px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Create Project
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
