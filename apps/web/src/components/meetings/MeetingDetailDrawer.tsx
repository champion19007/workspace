'use client';

import React, { useState, useEffect, useCallback, useMemo, useId } from 'react';
import Link from 'next/link';
import { RotateCw, Copy, Check, Trash2, Search, Sparkles, Quote, ShieldCheck } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { Dialog } from '@/components/ui/dialog';
import { Badge, MEETING_STATUS_META, MeetingStatusBadge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/states';
import { ActionItemCard } from '@/components/approvals/ActionItemCard';
import { SafeMarkdownView } from '@/components/docs/SafeMarkdownView';
import { formatDateTime } from '@/lib/format';
import type {
  ZoomMeetingDTO,
  NormalizedTranscriptSegment,
  MeetingNotesDTO,
  ActionItemDTO,
} from '@workspace/core';

interface MeetingDetailDrawerProps {
  meeting: ZoomMeetingDTO | null;
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  onMeetingUpdated?: (updated: ZoomMeetingDTO) => void;
}

interface SpeakerItem {
  speakerLabel: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  resolutionMethod: string | null;
  resolutionConfidence: number | null;
  segmentCount: number;
}

interface CandidateProject {
  id: string;
  name: string;
  path: string;
  teamName?: string | null;
}

interface OrgMember {
  id: string;
  name: string;
  email: string;
}

type Tab = 'notes' | 'transcript' | 'details';

function formatMsToTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

const SPEAKER_METHOD: Record<string, { label: string; tone: 'success' | 'info' | 'accent' }> = {
  email_verified: { label: 'Matched by email', tone: 'success' },
  fuzzy_llm: { label: 'Matched by AI', tone: 'info' },
  manual: { label: 'Set by hand', tone: 'accent' },
};

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h3 className="text-sm font-semibold text-fg">
      {children}
      {count !== undefined && <span className="ml-1.5 font-normal text-fg-muted">{count}</span>}
    </h3>
  );
}

export function MeetingDetailDrawer({
  meeting,
  isOpen,
  onClose,
  orgId,
  onMeetingUpdated,
}: MeetingDetailDrawerProps) {
  const ids = useId();
  const [activeTab, setActiveTab] = useState<Tab>('notes');

  // Retry state
  const [retrying, setRetrying] = useState(false);
  const [copiedUuid, setCopiedUuid] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Transcript state
  const [segments, setSegments] = useState<NormalizedTranscriptSegment[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [copiedAnchorSeq, setCopiedAnchorSeq] = useState<number | null>(null);

  // Skip & Purge state
  const [isSkipModalOpen, setIsSkipModalOpen] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);

  // Speakers
  const [speakers, setSpeakers] = useState<SpeakerItem[]>([]);
  const [loadingSpeakers, setLoadingSpeakers] = useState(false);
  const [speakersError, setSpeakersError] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [editingSpeakerLabel, setEditingSpeakerLabel] = useState<string | null>(null);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<string>('');
  const [savingSpeakerMapping, setSavingSpeakerMapping] = useState(false);
  const [speakerSaveError, setSpeakerSaveError] = useState<string | null>(null);

  // Project routing
  const [candidates, setCandidates] = useState<CandidateProject[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [routingReasonInput, setRoutingReasonInput] = useState<string>('');
  const [routingSubmitting, setRoutingSubmitting] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [routingSuccess, setRoutingSuccess] = useState<string | null>(null);

  // Guest consent
  const [isResolvingGuestConsent, setIsResolvingGuestConsent] = useState(false);
  const [guestConsentNotes, setGuestConsentNotes] = useState('');
  const [guestConsentError, setGuestConsentError] = useState<string | null>(null);

  // Notes & suggested action items
  const [notes, setNotes] = useState<MeetingNotesDTO | null>(null);
  const [actionItems, setActionItems] = useState<ActionItemDTO[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const fetchNotes = useCallback(async (meetingId: string) => {
    setLoadingNotes(true);
    setNotesError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meetingId}/notes`);
      if (res.status === 404) {
        setNotes(null);
        setActionItems([]);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "The notes couldn't be loaded.");
      }
      setNotes(data.notes || null);
      setActionItems(data.actionItems || []);
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingNotes(false);
    }
  }, [orgId]);

  // Evidence links open the transcript tab and highlight the quoted line.
  const jumpToCue = (seq: number) => {
    setTranscriptSearch('');
    setActiveTab('transcript');
    setTimeout(() => {
      const el = document.getElementById(`seg-${seq}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-accent', 'bg-accent-subtle');
        setTimeout(() => {
          el.classList.remove('ring-2', 'ring-accent', 'bg-accent-subtle');
        }, 3000);
      }
    }, 60);
  };

  const fetchTranscript = useCallback(async (meetingId: string) => {
    setLoadingTranscript(true);
    setTranscriptError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meetingId}/transcript?limit=200`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "The transcript couldn't be loaded.");
      }
      setSegments(data.segments || []);
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTranscript(false);
    }
  }, [orgId]);

  const fetchSpeakers = useCallback(async (meetingId: string) => {
    setLoadingSpeakers(true);
    setSpeakersError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meetingId}/speakers`);
      const data = await res.json();
      if (res.ok) {
        setSpeakers(data.speakers || []);
      }
    } catch (err) {
      setSpeakersError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSpeakers(false);
    }
  }, [orgId]);

  const fetchCandidates = useCallback(async (meetingId: string) => {
    setLoadingCandidates(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meetingId}/routing-candidates`);
      const data = await res.json();
      if (res.ok) {
        setCandidates(data.candidates || []);
      }
    } catch {
      // Ignore background candidate fetch failure
    } finally {
      setLoadingCandidates(false);
    }
  }, [orgId]);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/members`);
      const data = await res.json();
      if (res.ok) {
        setMembers(data.members || []);
      }
    } catch {
      // Ignore background members fetch failure
    }
  }, [orgId]);

  useEffect(() => {
    if (isOpen && meeting) {
      const hasTranscriptStage =
        meeting.status === 'transcript_ready' ||
        meeting.status === 'awaiting_project_choice' ||
        meeting.status === 'routed' ||
        meeting.status === 'completed' ||
        meeting.hasTranscript;
      const hasNotesStage = meeting.status === 'completed' || meeting.status === 'routed' || meeting.hasTranscript;
      if (hasTranscriptStage) {
        fetchTranscript(meeting.id);
        fetchSpeakers(meeting.id);
      }
      if (hasNotesStage) {
        fetchNotes(meeting.id);
      }
      fetchCandidates(meeting.id);
      fetchMembers();
      setSelectedProjectId(meeting.nodeId || meeting.suggestedNodeId || '');
      setRoutingReasonInput('');
      setRoutingError(null);
      setRoutingSuccess(null);
      setActiveTab(hasNotesStage ? 'notes' : hasTranscriptStage ? 'transcript' : 'details');
    } else {
      setSegments([]);
      setSpeakers([]);
      setCandidates([]);
      setNotes(null);
      setActionItems([]);
      setNotesError(null);
      setTranscriptError(null);
      setTranscriptSearch('');
      setEditingSpeakerLabel(null);
    }
  }, [isOpen, meeting, fetchTranscript, fetchSpeakers, fetchCandidates, fetchMembers, fetchNotes]);

  // Hooks must run before the early return below (meeting goes null -> value when a row is opened).
  const filteredSegments = useMemo(() => {
    if (!transcriptSearch.trim()) return segments;
    const q = transcriptSearch.toLowerCase().trim();
    return segments.filter(
      (s) =>
        s.text.toLowerCase().includes(q) ||
        s.speakerLabel.toLowerCase().includes(q) ||
        String(s.seq) === q
    );
  }, [segments, transcriptSearch]);

  if (!meeting) return null;

  const handleCopyUuid = () => {
    navigator.clipboard.writeText(meeting.providerMeetingUuid).catch(() => undefined);
    setCopiedUuid(true);
    setTimeout(() => setCopiedUuid(false), 2000);
  };

  const handleCopyAnchor = (seg: NormalizedTranscriptSegment) => {
    const anchorUrl = `${window.location.origin}${window.location.pathname}#anchor-${seg.seq}`;
    navigator.clipboard.writeText(anchorUrl).catch(() => undefined);
    setCopiedAnchorSeq(seg.seq);
    setTimeout(() => setCopiedAnchorSeq(null), 2000);
  };

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meeting.id}/retry`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "The meeting couldn't be checked again.");
      }
      if (data.meeting && onMeetingUpdated) {
        onMeetingUpdated(data.meeting);
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  };

  const handleSkipMeeting = async () => {
    setSkipping(true);
    setSkipError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meeting.id}/skip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `v${meeting.version}`,
        },
        body: JSON.stringify({ reason: skipReason.trim() || undefined }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 412) {
          throw new Error('This meeting changed while you were looking at it. Close the panel, reopen the meeting and try again.');
        }
        if (res.status === 428) {
          throw new Error('The request was missing its version check. Reload the page and try again.');
        }
        throw new Error(data.message || data.detail || "The meeting couldn't be skipped.");
      }

      setIsSkipModalOpen(false);
      setSegments([]);
      if (data.meeting && onMeetingUpdated) {
        onMeetingUpdated(data.meeting);
      }
    } catch (err) {
      setSkipError(err instanceof Error ? err.message : String(err));
    } finally {
      setSkipping(false);
    }
  };

  const handleRouteMeeting = async () => {
    if (!selectedProjectId) {
      setRoutingError('Choose a project first.');
      return;
    }

    setRoutingSubmitting(true);
    setRoutingError(null);
    setRoutingSuccess(null);

    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meeting.id}/route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `v${meeting.version}`,
        },
        body: JSON.stringify({
          nodeId: selectedProjectId,
          reason: routingReasonInput.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 412) {
          throw new Error('This meeting changed while you were looking at it. Reopen it and try again.');
        }
        throw new Error(data.message || "The meeting couldn't be moved to that project.");
      }

      setRoutingSuccess(`Moved to ${candidates.find((c) => c.id === selectedProjectId)?.name ?? 'the project'}. Notes will be written there.`);
      if (data.meeting && onMeetingUpdated) {
        onMeetingUpdated(data.meeting);
      }
    } catch (err) {
      setRoutingError(err instanceof Error ? err.message : String(err));
    } finally {
      setRoutingSubmitting(false);
    }
  };

  const handleSaveSpeakerMapping = async () => {
    if (!editingSpeakerLabel) return;
    setSavingSpeakerMapping(true);
    setSpeakerSaveError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meeting.id}/speakers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speakerLabel: editingSpeakerLabel,
          userId: selectedUserForEdit || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "The speaker couldn't be updated.");
      }

      setEditingSpeakerLabel(null);
      await fetchSpeakers(meeting.id);
      await fetchTranscript(meeting.id);
      if (data.meeting && onMeetingUpdated) {
        onMeetingUpdated(data.meeting);
      }
    } catch (err) {
      setSpeakerSaveError(err instanceof Error ? err.message : "The speaker couldn't be updated.");
    } finally {
      setSavingSpeakerMapping(false);
    }
  };

  const handleResolveGuestConsent = async () => {
    setIsResolvingGuestConsent(true);
    setGuestConsentError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meeting.id}/guest-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestConsentStatus: 'consented',
          attestationNotes: guestConsentNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "The consent confirmation couldn't be saved.");
      }

      if (data.meeting && onMeetingUpdated) {
        onMeetingUpdated(data.meeting);
      }
    } catch (err) {
      setGuestConsentError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsResolvingGuestConsent(false);
    }
  };

  const canRetry =
    meeting.status === 'intake_failed' ||
    meeting.status === 'pending_consent' ||
    meeting.status === 'connection_requires_reconnection';

  const canSkip = !meeting.skipped && meeting.status !== 'skipped';
  const showRouting =
    meeting.status === 'awaiting_project_choice' || meeting.status === 'routed' || meeting.status === 'transcript_ready';
  const statusMeta = MEETING_STATUS_META[meeting.status];

  const validItems = actionItems.filter((i) => i.validationStatus !== 'invalid_evidence');
  const invalidItems = actionItems.filter((i) => i.validationStatus === 'invalid_evidence');
  const pendingCount = validItems.filter((i) => i.state === 'suggested').length;

  const subtitle = [
    meeting.actualStartAt ? formatDateTime(meeting.actualStartAt) : null,
    meeting.durationSeconds ? `${Math.round(meeting.durationSeconds / 60)} min` : null,
    meeting.zoomHostEmail,
  ]
    .filter(Boolean)
    .join(' · ');

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'notes', label: 'Notes', count: pendingCount || undefined },
    { id: 'transcript', label: 'Transcript', count: segments.length || undefined },
    { id: 'details', label: 'Details' },
  ];

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={meeting.title || 'Untitled meeting'}
        description={subtitle || undefined}
        widthClass="max-w-2xl w-full"
      >
        <div className="space-y-5">
          {/* Where the meeting is in processing, and what (if anything) it needs from you. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <MeetingStatusBadge status={meeting.status} />
            {statusMeta && <span className="text-sm text-fg-muted">{statusMeta.hint}</span>}
            {meeting.nodeId && meeting.nodeTitle && meeting.status !== 'awaiting_project_choice' && (
              <Link href={`/orgs/${orgId}/projects/${meeting.nodeId}/dashboard`} className="link text-sm">
                {meeting.nodeTitle}
              </Link>
            )}
          </div>

          {meeting.intakeError && <Alert title="What went wrong">{meeting.intakeError}</Alert>}

          {meeting.guestsPresent && meeting.guestConsentStatus !== 'consented' && (
            <Alert tone="warning" title="Guests were in this meeting">
              <p>Confirm that everyone was told the meeting was recorded and transcribed. Processing waits until you do.</p>
              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  aria-label="How consent was given (optional)"
                  placeholder="How was consent given? (optional)"
                  value={guestConsentNotes}
                  onChange={(e) => setGuestConsentNotes(e.target.value)}
                  className="field field-sm flex-1"
                />
                <button
                  type="button"
                  onClick={handleResolveGuestConsent}
                  disabled={isResolvingGuestConsent}
                  className="btn btn-secondary btn-sm"
                >
                  <ShieldCheck aria-hidden="true" />
                  {isResolvingGuestConsent ? 'Saving…' : 'Guests consented'}
                </button>
              </div>
              {guestConsentError && <p className="mt-2 text-danger">{guestConsentError}</p>}
            </Alert>
          )}

          {showRouting && (
            <section aria-labelledby={`${ids}-routing`} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`${ids}-routing`} className="text-sm font-semibold text-fg">
                  {meeting.status === 'routed' ? 'Project' : 'Which project is this meeting for?'}
                </h3>
                {meeting.routingConfidence !== null && meeting.routingConfidence !== undefined && (
                  <Badge variant={meeting.routingConfidence >= 0.7 ? 'success' : 'warning'}>
                    {Math.round(meeting.routingConfidence * 100)}% match
                  </Badge>
                )}
              </div>

              {meeting.suggestedNodeId && (
                <p className="flex items-start gap-2 text-sm text-fg-muted">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                  <span>
                    Suggested:{' '}
                    <span className="font-medium text-fg">
                      {candidates.find((c) => c.id === meeting.suggestedNodeId)?.name || meeting.suggestedNodeTitle || 'a project'}
                    </span>
                    {meeting.routingReason && <span> because “{meeting.routingReason}”</span>}
                  </span>
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={routingSubmitting || loadingCandidates}
                  aria-label="Project"
                  className="field field-sm flex-1"
                >
                  <option value="">Choose a project</option>
                  {candidates.map((cand) => (
                    <option key={cand.id} value={cand.id}>
                      {cand.teamName ? `${cand.teamName} › ` : ''}
                      {cand.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleRouteMeeting}
                  disabled={routingSubmitting || !selectedProjectId}
                  className="btn btn-primary btn-sm"
                >
                  {routingSubmitting ? 'Saving…' : meeting.status === 'routed' ? 'Move meeting' : 'Use this project'}
                </button>
              </div>

              {routingError && <Alert>{routingError}</Alert>}
              {routingSuccess && <Alert tone="success">{routingSuccess}</Alert>}
            </section>
          )}

          <div role="tablist" aria-label="Meeting sections" className="tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`${ids}-tab-${t.id}`}
                aria-selected={activeTab === t.id}
                aria-controls={`${ids}-panel-${t.id}`}
                tabIndex={activeTab === t.id ? 0 : -1}
                onClick={() => setActiveTab(t.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  const i = tabs.findIndex((x) => x.id === activeTab);
                  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
                  setActiveTab(next.id);
                  document.getElementById(`${ids}-tab-${next.id}`)?.focus();
                }}
                className="tab"
              >
                {t.label}
                {t.count !== undefined && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>

          {/* Notes */}
          <div role="tabpanel" id={`${ids}-panel-notes`} aria-labelledby={`${ids}-tab-notes`} hidden={activeTab !== 'notes'} className="space-y-6">
            {loadingNotes ? (
              <div role="status" aria-busy="true" className="space-y-2">
                <span className="sr-only">Loading notes…</span>
                <div className="skeleton h-3.5 w-full" />
                <div className="skeleton h-3.5 w-5/6" />
                <div className="skeleton h-3.5 w-2/3" />
              </div>
            ) : notesError ? (
              <Alert
                action={
                  <button type="button" onClick={() => fetchNotes(meeting.id)} className="link shrink-0">
                    Try again
                  </button>
                }
              >
                {notesError}
              </Alert>
            ) : !notes && actionItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-muted">
                Notes appear here once the transcript is in and the meeting has a project.
              </p>
            ) : (
              <>
                {notes?.summaryMd && (
                  <section className="space-y-2">
                    <SectionTitle>Summary</SectionTitle>
                    <SafeMarkdownView content={notes.summaryMd} />
                  </section>
                )}

                {notes && notes.decisions && notes.decisions.length > 0 && (
                  <section className="space-y-2">
                    <SectionTitle count={notes.decisions.length}>Decisions</SectionTitle>
                    <ul className="space-y-2">
                      {notes.decisions.map((dec, idx) => (
                        <li key={idx} className="space-y-1 text-sm">
                          <p className="text-fg">{dec.text}</p>
                          {dec.evidence?.map((ev, evIdx) => (
                            <button
                              key={evIdx}
                              type="button"
                              onClick={() => jumpToCue(ev.seq)}
                              className="flex max-w-full items-start gap-1.5 text-left text-xs text-fg-muted hover:text-accent-text"
                              title="Show this line in the transcript"
                            >
                              <Quote className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">“{ev.quote}”</span>
                            </button>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {notes && notes.openQuestions && notes.openQuestions.length > 0 && (
                  <section className="space-y-2">
                    <SectionTitle count={notes.openQuestions.length}>Open questions</SectionTitle>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-fg marker:text-fg-subtle">
                      {notes.openQuestions.map((q, idx) => (
                        <li key={idx}>{q.text}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {actionItems.length > 0 && (
                  <section className="space-y-3">
                    <div className="space-y-0.5">
                      <SectionTitle count={validItems.length}>Suggested action items</SectionTitle>
                      <p className="text-xs text-fg-muted">
                        {pendingCount > 0 ? `${pendingCount} waiting for a decision. ` : ''}Tasks change only after someone approves.
                      </p>
                    </div>
                    <div className="space-y-3">
                      {validItems.map((item) => (
                        <ActionItemCard
                          key={item.id}
                          item={item}
                          orgId={orgId}
                          onJumpToCue={jumpToCue}
                          onItemChange={(updated) => setActionItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
                        />
                      ))}
                    </div>

                    {invalidItems.length > 0 && (
                      <details className="rounded-lg border border-border px-3 py-2 text-sm">
                        <summary className="cursor-pointer text-fg-muted">
                          {invalidItems.length} suggestion{invalidItems.length === 1 ? '' : 's'} hidden because the quote wasn't found in the transcript
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {invalidItems.map((inv) => (
                            <li key={inv.id} className="space-y-0.5">
                              <p className="text-fg-muted line-through">{inv.text}</p>
                              <p className="text-xs text-fg-subtle">Quoted: “{inv.evidence?.[0]?.quote || 'none'}”</p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                )}
              </>
            )}
          </div>

          {/* Transcript */}
          <div role="tabpanel" id={`${ids}-panel-transcript`} aria-labelledby={`${ids}-tab-transcript`} hidden={activeTab !== 'transcript'} className="space-y-5">
            {(speakers.length > 0 || loadingSpeakers || speakersError) && (
              <section className="space-y-2">
                <SectionTitle count={speakers.length}>Speakers</SectionTitle>
                {loadingSpeakers ? (
                  <div className="skeleton h-12 w-full" aria-hidden="true" />
                ) : speakersError ? (
                  <Alert>{speakersError}</Alert>
                ) : (
                  <ul className="card divide-y divide-border overflow-hidden">
                    {speakers.map((spk) => {
                      const isEditing = editingSpeakerLabel === spk.speakerLabel;
                      const method = spk.resolutionMethod ? SPEAKER_METHOD[spk.resolutionMethod] : undefined;
                      return (
                        <li key={spk.speakerLabel} className="flex flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-fg">{spk.speakerLabel}</span>
                              {method ? <Badge variant={method.tone}>{method.label}</Badge> : <Badge>Not matched</Badge>}
                            </p>
                            <p className="truncate text-xs text-fg-muted">
                              {spk.userName ? `${spk.userName} · ${spk.userEmail}` : 'Guest or not linked to a member'}
                            </p>
                          </div>
                          {isEditing ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <select
                                value={selectedUserForEdit}
                                onChange={(e) => setSelectedUserForEdit(e.target.value)}
                                aria-label={`Member for ${spk.speakerLabel}`}
                                className="field field-sm w-auto"
                              >
                                <option value="">Not a member</option>
                                {members.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                              </select>
                              <button type="button" onClick={handleSaveSpeakerMapping} disabled={savingSpeakerMapping} className="btn btn-primary btn-sm">
                                {savingSpeakerMapping ? 'Saving…' : 'Save'}
                              </button>
                              <button type="button" onClick={() => setEditingSpeakerLabel(null)} className="btn btn-ghost btn-sm">
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSpeakerLabel(spk.speakerLabel);
                                setSelectedUserForEdit(spk.userId || '');
                              }}
                              className="btn btn-ghost btn-sm self-start sm:self-auto"
                            >
                              Change
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {speakerSaveError && <Alert onDismiss={() => setSpeakerSaveError(null)}>{speakerSaveError}</Alert>}
              </section>
            )}

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle count={segments.length || undefined}>Transcript</SectionTitle>
                {segments.length > 0 && (
                  <div className="relative w-full sm:w-56">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
                    <input
                      type="search"
                      aria-label="Search the transcript"
                      placeholder="Search words or speaker"
                      value={transcriptSearch}
                      onChange={(e) => setTranscriptSearch(e.target.value)}
                      className="field field-sm pl-8"
                    />
                  </div>
                )}
              </div>

              {loadingTranscript ? (
                <div role="status" aria-busy="true" className="space-y-2">
                  <span className="sr-only">Loading transcript…</span>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skeleton h-14 w-full" />
                  ))}
                </div>
              ) : transcriptError ? (
                <Alert
                  action={
                    <button type="button" onClick={() => fetchTranscript(meeting.id)} className="link shrink-0">
                      Try again
                    </button>
                  }
                >
                  {transcriptError}
                </Alert>
              ) : segments.length === 0 ? (
                <p className="py-6 text-center text-sm text-fg-muted">
                  {meeting.skipped ? 'This meeting was skipped and its transcript deleted.' : 'The transcript will appear once Zoom has processed the recording.'}
                </p>
              ) : filteredSegments.length === 0 ? (
                <p className="py-6 text-center text-sm text-fg-muted">No lines match “{transcriptSearch}”.</p>
              ) : (
                <ol className="space-y-1">
                  {filteredSegments.map((seg) => (
                    <li key={seg.seq} id={`seg-${seg.seq}`} className="group rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-fg">{seg.speakerLabel}</span>
                        <span className="font-mono tabular-nums text-fg-subtle">{formatMsToTimestamp(seg.startMs)}</span>
                        <button
                          type="button"
                          onClick={() => handleCopyAnchor(seg)}
                          className="ml-auto rounded p-1 text-fg-subtle opacity-100 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0"
                          aria-label={`Copy link to line ${seg.seq}`}
                          title="Copy link to this line"
                        >
                          {copiedAnchorSeq === seg.seq ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{seg.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          {/* Details */}
          <div role="tabpanel" id={`${ids}-panel-details`} aria-labelledby={`${ids}-tab-details`} hidden={activeTab !== 'details'} className="space-y-6">
            <dl className="card divide-y divide-border overflow-hidden text-sm">
              {[
                ['Host', meeting.zoomHostEmail || meeting.zoomHostId || 'Unknown'],
                ['Started', meeting.actualStartAt ? `${formatDateTime(meeting.actualStartAt)}${meeting.timezone ? ` (${meeting.timezone})` : ''}` : '—'],
                ['Length', meeting.durationSeconds ? `${Math.round(meeting.durationSeconds / 60)} minutes` : '—'],
                ['Recording', meeting.hasRecording ? 'Available' : 'None'],
                ['Transcript', meeting.hasTranscript ? 'Available' : 'Not yet'],
                ...(meeting.transcriptRetentionDeadline
                  ? [['Transcript deleted on', new Date(meeting.transcriptRetentionDeadline).toLocaleDateString()]]
                  : []),
                ...(notes ? [['Notes written by', `${notes.model} (${notes.promptVersion})`]] : []),
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-3 gap-3 px-4 py-2.5">
                  <dt className="text-fg-muted">{k}</dt>
                  <dd className="col-span-2 break-words text-fg">{v}</dd>
                </div>
              ))}
              <div className="grid grid-cols-3 gap-3 px-4 py-2.5">
                <dt className="text-fg-muted">Zoom ID</dt>
                <dd className="col-span-2 flex items-start justify-between gap-2">
                  <span className="break-all font-mono text-xs text-fg">{meeting.providerNumericId || meeting.providerMeetingUuid}</span>
                  <button type="button" onClick={handleCopyUuid} className="btn btn-ghost btn-sm -my-1 shrink-0">
                    {copiedUuid ? <Check className="text-success" aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copiedUuid ? 'Copied' : 'Copy'}
                  </button>
                </dd>
              </div>
            </dl>

            {retryError && <Alert onDismiss={() => setRetryError(null)}>{retryError}</Alert>}

            {(canRetry || canSkip) && (
              <div className="flex flex-wrap gap-2">
                {canRetry && (
                  <button type="button" onClick={handleRetry} disabled={retrying} className="btn btn-primary btn-sm">
                    <RotateCw className={retrying ? 'animate-spin' : ''} aria-hidden="true" />
                    {retrying ? 'Checking…' : 'Check again'}
                  </button>
                )}
                {canSkip && (
                  <button type="button" onClick={() => setIsSkipModalOpen(true)} className="btn btn-danger-soft btn-sm">
                    <Trash2 aria-hidden="true" />
                    Skip and delete data
                  </button>
                )}
              </div>
            )}

            {meeting.skipped && (
              <p className="text-sm text-fg-muted">This meeting was skipped. Its transcript, notes and suggestions were deleted.</p>
            )}
          </div>
        </div>
      </Drawer>

      <Dialog
        isOpen={isSkipModalOpen}
        onClose={() => !skipping && setIsSkipModalOpen(false)}
        title="Skip this meeting?"
        description="Its transcript, notes and suggested action items are deleted for good, and nothing more is processed. Tasks you already approved stay."
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor={`${ids}-skip-reason`} className="label">
              Reason <span className="font-normal text-fg-subtle">(optional)</span>
            </label>
            <input
              id={`${ids}-skip-reason`}
              type="text"
              placeholder="e.g. Private conversation"
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              disabled={skipping}
              className="field"
            />
          </div>

          {skipError && <Alert>{skipError}</Alert>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setIsSkipModalOpen(false)} disabled={skipping} className="btn btn-ghost">
              Cancel
            </button>
            <button type="button" onClick={handleSkipMeeting} disabled={skipping} className="btn btn-danger">
              {skipping ? 'Deleting…' : 'Skip and delete'}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
