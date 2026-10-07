'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Video,
  Clock,
  Search,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { TableShell } from '@/components/ui/table-shell';
import { MeetingDetailDrawer } from '@/components/meetings/MeetingDetailDrawer';
import type { ZoomMeetingDTO, ZoomMeetingStatus } from '@workspace/core';

export default function MeetingsPage() {
  const params = useParams();
  const orgId = params.orgId as string;

  const [meetings, setMeetings] = useState<ZoomMeetingDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Drawer state
  const [selectedMeeting, setSelectedMeeting] = useState<ZoomMeetingDTO | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const fetchMeetings = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);

    try {
      const url = new URL(`/api/orgs/${orgId}/meetings`, window.location.origin);
      if (statusFilter !== 'all') {
        url.searchParams.set('status', statusFilter);
      }
      if (searchQuery.trim()) {
        url.searchParams.set('query', searchQuery.trim());
      }

      const res = await fetch(url.toString());
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to fetch meetings');
      }

      setMeetings(data.meetings || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, statusFilter, searchQuery]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const handleRowClick = (meeting: ZoomMeetingDTO) => {
    setSelectedMeeting(meeting);
    setIsDrawerOpen(true);
  };

  const handleMeetingUpdated = (updated: ZoomMeetingDTO) => {
    setSelectedMeeting(updated);
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  const getStatusBadge = (status: ZoomMeetingStatus) => {
    switch (status) {
      case 'routed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            Routed
          </span>
        );
      case 'awaiting_project_choice':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3" />
            Awaiting Project
          </span>
        );
      case 'routing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Clock className="w-3 h-3" />
            Routing...
          </span>
        );
      case 'transcript_ready':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            Transcript Ready
          </span>
        );
      case 'ready_for_transcript_retrieval':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Clock className="w-3 h-3" />
            Ready for Retrieval
          </span>
        );
      case 'waiting_for_transcript':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3 h-3" />
            Waiting for Transcript
          </span>
        );
      case 'pending_consent':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <ShieldCheck className="w-3 h-3" />
            Pending Consent
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
            Skipped
          </span>
        );
      case 'connection_requires_reconnection':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <AlertTriangle className="w-3 h-3" />
            Reconnection Needed
          </span>
        );
      case 'intake_failed':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertTriangle className="w-3 h-3" />
            Intake Failed
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Meetings & Transcripts
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Verified Zoom cloud recordings, intake lifecycle states, and transcript readiness.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-accent bg-accent/10 px-2.5 py-1 rounded-lg border border-accent/20">
            Stage 12 Webhook Intake Active
          </span>
          <button
            type="button"
            onClick={() => fetchMeetings()}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border-subtle hover:bg-panel-elevated text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh meetings list"
          >
            <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Toolbar: Filters and Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          {[
            { id: 'all', label: 'All' },
            { id: 'awaiting_project_choice', label: 'Awaiting Project' },
            { id: 'routed', label: 'Routed' },
            { id: 'transcript_ready', label: 'Transcript Ready' },
            { id: 'ready_for_transcript_retrieval', label: 'Ready for Retrieval' },
            { id: 'waiting_for_transcript', label: 'Waiting for Transcript' },
            { id: 'pending_consent', label: 'Pending Consent' },
            { id: 'skipped', label: 'Skipped' },
            { id: 'intake_failed', label: 'Failed' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors whitespace-nowrap font-medium ${
                statusFilter === tab.id
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-panel-elevated border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search topic or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-panel-inset border border-border-subtle focus:border-accent focus:outline-none text-foreground placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <TableShell>
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-panel-inset border-b border-border-subtle text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
              <th className="py-3 px-4">Topic & Meeting ID</th>
              <th className="py-3 px-4">Host</th>
              <th className="py-3 px-4">Date & Time</th>
              <th className="py-3 px-4">Duration</th>
              <th className="py-3 px-4">Intake State</th>
              <th className="py-3 px-4">Media</th>
              <th className="py-3 px-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/60">
            {loading && meetings.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  <RotateCw className="w-4 h-4 animate-spin mx-auto mb-2 text-accent" />
                  Loading meetings...
                </td>
              </tr>
            ) : meetings.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  <div className="max-w-sm mx-auto space-y-2">
                    <Video className="w-8 h-8 mx-auto text-muted-foreground/50" />
                    <div className="font-semibold text-foreground text-sm">No Meetings Recorded</div>
                    <p className="text-xs text-muted-foreground">
                      {statusFilter !== 'all' || searchQuery
                        ? 'No meetings match your filter criteria.'
                        : 'Connect your Zoom account in Settings and complete host opt-in to begin capturing meeting transcripts automatically.'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              meetings.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => handleRowClick(m)}
                  className="hover:bg-panel-elevated/40 transition-colors cursor-pointer"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-panel-inset border border-border-subtle flex items-center justify-center text-accent">
                        <Video className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{m.title || 'Untitled Meeting'}</div>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {m.providerNumericId || m.providerMeetingUuid.slice(0, 16) + '...'}
                        </span>
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-4 text-muted-foreground font-mono text-[11px]">
                    {m.zoomHostEmail || m.zoomHostId || '—'}
                  </td>

                  <td className="py-3 px-4 text-muted-foreground">
                    {m.actualStartAt ? new Date(m.actualStartAt).toLocaleDateString() : '—'}
                  </td>

                  <td className="py-3 px-4 text-muted-foreground">
                    {m.durationSeconds ? `${Math.round(m.durationSeconds / 60)}m` : '—'}
                  </td>

                  <td className="py-3 px-4">
                    {getStatusBadge(m.status)}
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono">
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          m.hasRecording ? 'bg-emerald-500/10 text-emerald-400' : 'bg-panel-inset text-muted-foreground'
                        }`}
                        title="Recording file present"
                      >
                        REC
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          m.hasTranscript ? 'bg-emerald-500/10 text-emerald-400' : 'bg-panel-inset text-muted-foreground'
                        }`}
                        title="Transcript file present"
                      >
                        TXT
                      </span>
                    </div>
                  </td>

                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-panel-elevated"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableShell>

      {/* Details Drawer */}
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
