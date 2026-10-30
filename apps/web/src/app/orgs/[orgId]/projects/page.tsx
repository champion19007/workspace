'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Search, Plus, FolderKanban, Lock, SearchX, Users } from 'lucide-react';
import type { HealthStatus } from '@workspace/core';
import { Dialog } from '@/components/ui/dialog';
import { Badge, HealthBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, SkeletonCards, Alert } from '@/components/ui/states';
import { useShell } from '@/components/shell/shell-context';

interface ProjectItem {
  id: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  parentId: string | null;
  teamName: string | null;
  memberCount: number;
  rollup?: { health?: HealthStatus; completionPercentage?: number; overdueCount?: number; tasks?: { total?: number } } | null;
}

interface TeamOption {
  id: string;
  name: string;
}

export default function ProjectsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = params?.orgId as string;
  const { refreshProjects } = useShell();
  const ids = useId();

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(searchParams.get('new') === '1');
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const [newVisibility, setNewVisibility] = useState<'public' | 'private'>('public');
  const [newDesc, setNewDesc] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // The sidebar's "+" links here with ?new=1.
  useEffect(() => {
    if (searchParams.get('new') === '1') setIsModalOpen(true);
  }, [searchParams]);

  const fetchProjectsAndTeams = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const treeRes = await fetch(`/api/orgs/${orgId}/tree?depth=10`);
      if (treeRes.ok) {
        const treeData = await treeRes.json();
        const availableTeams: TeamOption[] = (treeData.nodes || [])
          .filter((n: { kind: string }) => n.kind === 'team')
          .map((n: { id: string; name: string }) => ({ id: n.id, name: n.name }));
        setTeams(availableTeams);
        setNewParentId((current) => current || availableTeams[0]?.id || '');
      }

      const teamQuery = teamFilter !== 'all' ? `&teamId=${teamFilter}` : '';
      const projRes = await fetch(`/api/orgs/${orgId}/projects?limit=100${teamQuery}`);
      if (!projRes.ok) {
        const err = await projRes.json().catch(() => ({}));
        throw new Error(err.message || "Projects couldn't be loaded.");
      }
      const projData = await projRes.json();
      setProjects(projData.projects || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, teamFilter]);

  useEffect(() => {
    if (orgId) fetchProjectsAndTeams();
  }, [orgId, fetchProjectsAndTeams]);

  const closeModal = () => {
    setIsModalOpen(false);
    if (searchParams.get('new')) router.replace(`/orgs/${orgId}/projects`);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newParentId) {
      setCreateError('Give the project a name and pick its team.');
      return;
    }

    try {
      setCreating(true);
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
        const err = await res.json().catch(() => ({}));
        setCreateError(err.message || "The project couldn't be created.");
        return;
      }

      const created = await res.json();
      setNewName('');
      setNewDesc('');
      refreshProjects();
      router.push(`/orgs/${orgId}/projects/${created.id}/dashboard`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredProjects = projects.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      (p.teamName ?? '').toLowerCase().includes(q)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Projects hold tasks, docs and meeting notes. Each one belongs to a team."
        actions={
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setIsModalOpen(true);
            }}
            className="btn btn-primary"
          >
            <Plus aria-hidden="true" />
            New project
          </button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <input
            type="search"
            placeholder="Filter by name, team or description"
            aria-label="Filter projects"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="field field-sm pl-9"
          />
        </div>
        {teams.length > 1 && (
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} aria-label="Team" className="field field-sm w-auto">
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && projects.length === 0 ? (
        <SkeletonCards count={6} />
      ) : error ? (
        <ErrorState title="Couldn't load projects" message={error} onRetry={fetchProjectsAndTeams} />
      ) : projects.length === 0 ? (
        teams.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Create a team first"
            description="Projects live inside teams. Add a team, then create its first project."
            action={{ label: 'Go to Teams', href: `/orgs/${orgId}/teams`, primary: true }}
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create a project to start planning tasks, writing docs and collecting meeting notes."
            action={{ label: 'New project', onClick: () => setIsModalOpen(true), primary: true }}
          />
        )
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No projects match"
          description={`Nothing matches “${searchQuery}”. Try a different word or team.`}
          action={{ label: 'Clear filter', onClick: () => setSearchQuery('') }}
          compact
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map((p) => {
            const pct = p.rollup?.completionPercentage ?? 0;
            const overdue = p.rollup?.overdueCount ?? 0;
            return (
              <li key={p.id}>
                <Link
                  href={`/orgs/${orgId}/projects/${p.id}/dashboard`}
                  className="card group flex h-full flex-col gap-4 p-5 transition-colors hover:border-border-strong"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold text-fg group-hover:underline">{p.name}</h2>
                      {p.visibility === 'private' && <Badge icon={Lock}>Private</Badge>}
                    </div>
                    {p.teamName && <p className="text-xs text-fg-muted">{p.teamName}</p>}
                    <p className="line-clamp-2 text-sm text-fg-muted">{p.description || 'No description yet.'}</p>
                  </div>

                  <div className="mt-auto space-y-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-fg-muted">{pct}% done</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {p.rollup?.health && <HealthBadge health={p.rollup.health} />}
                      {overdue > 0 && <span className="text-xs font-medium text-danger">{overdue} overdue</span>}
                      {p.visibility === 'private' && <span className="text-xs text-fg-muted">{p.memberCount} members</span>}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        isOpen={isModalOpen}
        onClose={closeModal}
        title="New project"
        description="A project belongs to a team and holds its own tasks, docs and meeting notes."
      >
        <form onSubmit={handleCreateProject} className="space-y-4">
          {createError && <Alert>{createError}</Alert>}

          <div>
            <label htmlFor={`${ids}-name`} className="label">
              Name
            </label>
            <input
              id={`${ids}-name`}
              type="text"
              required
              placeholder="e.g. Website relaunch"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <label htmlFor={`${ids}-team`} className="label">
              Team
            </label>
            {teams.length === 0 ? (
              <Alert tone="warning">
                There are no teams yet.{' '}
                <Link href={`/orgs/${orgId}/teams`} className="link">
                  Create a team
                </Link>{' '}
                first.
              </Alert>
            ) : (
              <select id={`${ids}-team`} value={newParentId} onChange={(e) => setNewParentId(e.target.value)} required className="field">
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <fieldset>
            <legend className="label">Who can see it</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: 'public', title: 'Everyone in the organization', hint: 'Anyone can find and follow it.' },
                  { value: 'private', title: 'Members only', hint: 'Plus organization owners and admins.' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors ${
                    newVisibility === opt.value ? 'border-accent bg-accent-subtle' : 'border-border-strong hover:border-input'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.value}
                    checked={newVisibility === opt.value}
                    onChange={() => setNewVisibility(opt.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium text-fg">{opt.title}</span>
                    <span className="block text-xs text-fg-muted">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`${ids}-desc`} className="label">
              Description <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <textarea
              id={`${ids}-desc`}
              rows={3}
              placeholder="What is this project for?"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="field resize-y"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={closeModal} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={teams.length === 0 || creating} className="btn btn-primary">
              {creating ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
