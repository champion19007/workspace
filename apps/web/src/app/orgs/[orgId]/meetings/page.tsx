'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Video, Search, RotateCw, ChevronRight, SearchX } from 'lucide-react';
import { MeetingDetailDrawer } from '@/components/meetings/MeetingDetailDrawer';
import { MeetingStatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import type { ZoomMeetingDTO } from '@workspace/core';
import { readDeepLinkId } from '@/lib/deep-link';
import { formatDateTime } from '@/lib/format';

// Grouped the way people think about meetings, not by pipeline stage.
const FILTERS: { id: string; label: string; statuses?: string[] }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Notes ready', statuses: ['completed'] },
  { id: 'attention', label: 'Needs you', statuses: ['awaiting_project_choice', 'pending_consent', 'connection_requires_reconnection'] },
  {
    id: 'processing',
    label: 'In progress',
    statuses: ['scheduled', 'waiting_for_transcript', 'ready_for_transcript_retrieval', 'ingesting', 'transcript_ready', 'routing', 'routed', 'extracting'],
  },
  { id: 'failed', label: 'Failed', statuses: ['failed', 'intake_failed'] },
  { id: 'skipped', label: 'Skipped', statuses: ['skipped'] },
];

export default function MeetingsPage() {
  const params = useParams();
  const orgId = params.orgId as string;

  const [meetings, setMeetings] = useState<ZoomMeetingDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [selectedMeeting, setSelectedMeeting] = useState<ZoomMeetingDTO | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const fetchMeetings = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);

    try {
      const url = new URL(`/api/orgs/${orgId}/meetings`, window.location.origin);
      if (debouncedSearch.trim()) url.searchParams.set('query', debouncedSearch.trim());

      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Meetings couldn't be loaded.");

      // Newest first by when the meeting happened.
      const list: ZoomMeetingDTO[] = data.meetings || [];
      list.sort((a, b) => (b.actualStartAt ?? b.scheduledStartAt ?? '').localeCompare(a.actualStartAt ?? a.scheduledStartAt ?? ''));
      setMeetings(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, debouncedSearch]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // Deep link (?meeting=<id>) used by task provenance lines, Home and the approvals inbox.
  const deepLinkHandled = React.useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || loading) return;
    const linkedId = readDeepLinkId(window.location.search, 'meeting');
    if (!linkedId) return;
    deepLinkHandled.current = true;
    const open = (meeting: ZoomMeetingDTO) => {
      setSelectedMeeting(meeting);
      setIsDrawerOpen(true);
    };
    const linked = meetings.find((m) => m.id === linkedId);
    if (linked) return open(linked);
    // Not in the loaded page (older than the newest 50, or filtered out): fetch that meeting on its own.
    fetch(`/api/orgs/${orgId}/meetings/${linkedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.meeting && open(data.meeting))
      .catch(() => undefined);
  }, [meetings, loading, orgId]);

  const openMeeting = (meeting: ZoomMeetingDTO) => {
    setSelectedMeeting(meeting);
    setIsDrawerOpen(true);
  };

  const handleMeetingUpdated = (updated: ZoomMeetingDTO) => {
    setSelectedMeeting(updated);
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  const countFor = (f: (typeof FILTERS)[number]) => (f.statuses ? meetings.filter((m) => f.statuses!.includes(m.status)).length : meetings.length);
  const active = FILTERS.find((f) => f.id === filter)!;
  const visible = active.statuses ? meetings.filter((m) => active.statuses!.includes(m.status)) : meetings;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description="Recorded Zoom meetings, their notes and the action items they suggest."
        actions={
          <button
            type="button"
            onClick={() => fetchMeetings()}
            disabled={loading}
            className="btn btn-secondary btn-icon"
            aria-label="Reload meetings"
            title="Reload meetings"
          >
            <RotateCw className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="segmented" role="group" aria-label="Show">
            {FILTERS.map((f) => {
              const n = countFor(f);
              return (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                  {!loading && <span className={`count ${f.id === 'attention' && n > 0 ? 'bg-warning-subtle text-warning' : ''}`}>{n}</span>}
                </button>
              );
            })}
          </div>
          <div className="relative lg:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search by title or Zoom ID"
              aria-label="Search meetings"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="field field-sm pl-9"
            />
          </div>
        </div>

        {loading && meetings.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : error ? (
          <ErrorState title="Couldn't load meetings" message={error} onRetry={fetchMeetings} />
        ) : meetings.length === 0 ? (
          debouncedSearch ? (
            <EmptyState
              icon={SearchX}
              title="No meetings match"
              description={`Nothing matches “${debouncedSearch}”.`}
              action={{ label: 'Clear search', onClick: () => setSearchQuery('') }}
              compact
            />
          ) : (
            <EmptyState
              icon={Video}
              title="No meetings yet"
              description="Connect Zoom in Settings and ask hosts to opt in. Their recorded meetings will appear here with notes."
              action={{ label: 'Open settings', href: `/orgs/${orgId}/settings`, primary: true }}
            />
          )
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Video}
            title={`No meetings in “${active.label}”`}
            description="Pick another filter to see the rest."
            action={{ label: 'Show all', onClick: () => setFilter('all') }}
            compact
          />
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {visible.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => openMeeting(m)}
                  className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60"
                >
                  <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted sm:flex">
                    <Video className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">{m.title || 'Untitled meeting'}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                      {m.actualStartAt && <span>{formatDateTime(m.actualStartAt)}</span>}
                      {m.durationSeconds ? <span>· {Math.round(m.durationSeconds / 60)} min</span> : null}
                      {m.nodeTitle && <span>· {m.nodeTitle}</span>}
                      {m.zoomHostEmail && <span className="hidden md:inline">· {m.zoomHostEmail}</span>}
                    </span>
                  </span>
                  <MeetingStatusBadge status={m.status} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MeetingDetailDrawer
        meeting={selectedMeeting}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        orgId={orgId}
        onMeetingUpdated={handleMeetingUpdated}
      />
    </div>
  );
}
