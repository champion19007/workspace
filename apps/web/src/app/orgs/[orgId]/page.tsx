'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CircleCheck, FolderKanban, Inbox, Video } from 'lucide-react';
import type { ActionItemDTO, MyTaskItemDTO, MyTasksCountsDTO, ZoomMeetingDTO } from '@workspace/core';
import { useShell } from '@/components/shell/shell-context';
import { GettingStarted } from '@/components/home/getting-started';
import { displayNameFromEmail } from '@/components/shell/account-menu';
import { HEALTH_META, MeetingStatusBadge, StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { dueLabel, formatDateTime, formatShortDate } from '@/lib/format';

function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: typeof Inbox;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card flex flex-col" aria-label={title}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Icon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="divide-y divide-border">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2 px-4 py-3.5">
          <div className="skeleton h-3.5" style={{ width: `${75 - i * 10}%` }} />
          <div className="skeleton h-2.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

function Stat({ href, label, value, tone }: { href: string; label: string; value: number; tone?: 'danger' }) {
  return (
    <Link href={href} className="rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-2/60">
      <div className={`text-xl font-semibold tabular-nums ${tone === 'danger' && value > 0 ? 'text-danger' : 'text-fg'}`}>{value}</div>
      <div className="text-xs text-fg-muted">{label}</div>
    </Link>
  );
}

export default function HomePage() {
  const { orgId, user, projects, projectsError, refreshProjects, meetingsAvailable } = useShell();
  const base = `/orgs/${orgId}`;

  const [mine, setMine] = useState<{ tasks: MyTaskItemDTO[]; counts: MyTasksCountsDTO } | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ items: ActionItemDTO[]; more: boolean } | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<ZoomMeetingDTO[] | null>(null);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    setMineError(null);
    setMine(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/me/tasks?category=pending&limit=50`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Your tasks couldn't be loaded.");
      setMine({ tasks: data.tasks ?? [], counts: data.counts });
    } catch (err) {
      setMineError(err instanceof Error ? err.message : String(err));
    }
  }, [orgId]);

  const loadSuggestions = useCallback(async () => {
    setSuggestionsError(null);
    setSuggestions(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/action-items?state=suggested&assignee=me&limit=4`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Suggestions couldn't be loaded.");
      setSuggestions({ items: data.items ?? [], more: Boolean(data.pageInfo?.hasNextPage) });
    } catch (err) {
      setSuggestionsError(err instanceof Error ? err.message : String(err));
    }
  }, [orgId]);

  const loadMeetings = useCallback(async () => {
    setMeetingsError(null);
    setMeetings(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings?limit=20`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Meetings couldn't be loaded.");
      const list: ZoomMeetingDTO[] = data.meetings ?? [];
      list.sort((a, b) => (b.actualStartAt ?? '').localeCompare(a.actualStartAt ?? ''));
      setMeetings(list);
    } catch (err) {
      setMeetingsError(err instanceof Error ? err.message : String(err));
    }
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    loadMine();
    loadSuggestions();
    loadMeetings();
  }, [orgId, loadMine, loadSuggestions, loadMeetings]);

  useEffect(() => {
    document.title = 'Home · Workspace';
  }, []);

  // Soonest due first (overdue dates sort earliest); undated last.
  const upNext = (mine?.tasks ?? [])
    .slice()
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    .slice(0, 6);

  // Greeting and date depend on the viewer's clock, so they render only once the session has loaded
  // on the client (the server render has no user and shows a placeholder).
  const firstName = user ? (user.name || displayNameFromEmail(user.email)).split(' ')[0] : null;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const summary: string[] = [];
  if (mine) {
    if (mine.counts.overdue) summary.push(`${mine.counts.overdue} overdue`);
    if (mine.counts.dueToday) summary.push(`${mine.counts.dueToday} due today`);
    if (mine.counts.upcoming) summary.push(`${mine.counts.upcoming} coming up`);
  }
  if (suggestions?.items.length) {
    const n = suggestions.items.length;
    summary.push(`${n}${suggestions.more ? '+' : ''} suggestion${n === 1 ? '' : 's'} to review`);
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        {firstName ? (
          <>
            <p className="text-sm text-fg-muted">
              {new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}
            </p>
            <h1 className="text-balance text-2xl font-semibold tracking-tight text-fg">
              {greeting}, {firstName}
            </h1>
            <p className="text-sm text-fg-muted">
              {summary.length ? `You have ${summary.join(', ')}.` : mine ? 'Nothing urgent on your plate.' : ' '}
            </p>
          </>
        ) : (
          <div className="space-y-2 py-1" aria-hidden="true">
            <div className="skeleton h-3.5 w-40" />
            <div className="skeleton h-7 w-72 max-w-full" />
            <div className="skeleton h-3.5 w-80 max-w-full" />
          </div>
        )}
      </header>

      <GettingStarted />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="My tasks" icon={CircleCheck} action={<SectionLink href={`${base}/my-tasks`}>View all</SectionLink>}>
            {mineError ? (
              <div className="p-4">
                <ErrorState title="Couldn't load your tasks" message={mineError} onRetry={loadMine} compact />
              </div>
            ) : !mine ? (
              <RowsSkeleton />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 p-4 pb-2">
                  <Stat href={`${base}/my-tasks?category=overdue`} label="Overdue" value={mine.counts.overdue} tone="danger" />
                  <Stat href={`${base}/my-tasks?category=due_today`} label="Due today" value={mine.counts.dueToday} />
                  <Stat href={`${base}/my-tasks?category=upcoming`} label="Coming up" value={mine.counts.upcoming} />
                </div>
                {upNext.length === 0 ? (
                  <div className="p-4 pt-2">
                    <EmptyState
                      icon={CircleCheck}
                      title="Nothing assigned to you"
                      description="Tasks assigned to you in any project show up here, soonest first."
                      action={{ label: 'Browse all tasks', href: `${base}/tasks` }}
                      compact
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {upNext.map((task) => {
                      const due = dueLabel(task.dueDate);
                      return (
                        <li key={task.id}>
                          <Link
                            href={`${base}/projects/${task.projectId}/tasks?task=${task.id}`}
                            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-fg">{task.title}</p>
                              <p className="truncate text-xs text-fg-muted">
                                <span className="font-mono">{task.key}</span> · {task.projectName}
                              </p>
                            </div>
                            <span className="hidden sm:block">
                              <StatusBadge status={task.status} />
                            </span>
                            <span className={`w-28 shrink-0 text-right text-sm tabular-nums ${due.overdue ? 'font-medium text-danger' : 'text-fg-muted'}`}>
                              {due.text || 'No due date'}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </Section>

          <Section title="Projects" icon={FolderKanban} action={<SectionLink href={`${base}/projects`}>All projects</SectionLink>}>
            {projects === null && projectsError ? (
              <div className="p-4">
                <ErrorState title="Couldn't load projects" onRetry={refreshProjects} compact />
              </div>
            ) : projects === null ? (
              <RowsSkeleton rows={3} />
            ) : projects.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={FolderKanban}
                  title="No projects yet"
                  description="Projects hold your tasks, board and docs. Create one to start planning."
                  action={{ label: 'Create a project', href: `${base}/projects?new=1`, primary: true }}
                  compact
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {projects.slice(0, 6).map((project) => {
                  const health = project.health ? HEALTH_META[project.health] : null;
                  const pct = project.completionPercentage ?? 0;
                  return (
                    <li key={project.id}>
                      <Link
                        href={`${base}/projects/${project.id}/dashboard`}
                        className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-fg">{project.name}</p>
                          <p className="flex items-center gap-1.5 truncate text-xs text-fg-muted">
                            {health && <span className={`h-2 w-2 shrink-0 rounded-full ${health.dot}`} aria-hidden="true" />}
                            {health?.label ?? 'No data yet'}
                            {project.overdueCount > 0 && <span className="text-danger">· {project.overdueCount} overdue</span>}
                            {project.teamName && <span className="hidden sm:inline">· {project.teamName}</span>}
                          </p>
                        </div>
                        <div className="flex w-32 shrink-0 items-center gap-2" title={`${pct}% of tasks done`}>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-9 text-right text-xs tabular-nums text-fg-muted">{pct}%</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Needs your review" icon={Inbox} action={<SectionLink href={`${base}/inbox`}>Inbox</SectionLink>}>
            {suggestionsError ? (
              <div className="p-4">
                <ErrorState title="Couldn't load suggestions" message={suggestionsError} onRetry={loadSuggestions} compact />
              </div>
            ) : !suggestions ? (
              <RowsSkeleton rows={3} />
            ) : suggestions.items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Inbox}
                  title="You're all caught up"
                  description="Action items from meetings that name you will wait here for your approval."
                  compact
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {suggestions.items.map((item) => (
                  <li key={item.id}>
                    <Link href={`${base}/inbox`} className="block px-4 py-3 transition-colors hover:bg-surface-2/60">
                      <p className="font-medium text-fg">{item.text}</p>
                      <p className="mt-0.5 truncate text-xs text-fg-muted">
                        {item.meeting?.title ?? 'Meeting'}
                        {item.suggestedDue && ` · due ${formatShortDate(item.suggestedDue)}`}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent meetings" icon={Video} action={<SectionLink href={`${base}/meetings`}>All meetings</SectionLink>}>
            {meetingsError ? (
              <div className="p-4">
                <ErrorState title="Couldn't load meetings" message={meetingsError} onRetry={loadMeetings} compact />
              </div>
            ) : !meetings ? (
              <RowsSkeleton rows={3} />
            ) : meetings.length === 0 ? (
              <div className="p-4">
                {meetingsAvailable === false ? (
                  <EmptyState
                    icon={Video}
                    title="Meeting import isn't set up"
                    description="This workspace doesn't bring in Zoom meetings yet. Projects, tasks and docs work as usual."
                    compact
                  />
                ) : (
                  <EmptyState
                    icon={Video}
                    title="No meetings yet"
                    description="Connect Zoom in Settings and recorded meetings will arrive here with notes."
                    action={{ label: 'Open settings', href: `${base}/settings` }}
                    compact
                  />
                )}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {meetings.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    <Link href={`${base}/meetings?meeting=${m.id}`} className="block space-y-1.5 px-4 py-3 transition-colors hover:bg-surface-2/60">
                      <p className="truncate font-medium text-fg">{m.title || 'Untitled meeting'}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                        <MeetingStatusBadge status={m.status} />
                        {m.actualStartAt && <span>{formatDateTime(m.actualStartAt)}</span>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
