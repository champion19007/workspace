'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Clock,
  User,
  Calendar,
  AlertTriangle,
  RotateCw,
  Copy,
  Check,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  Search,
  Hash,
  MessageSquare,
  FolderKanban,
  Users,
  Sparkles,
  ArrowRight,
  FileText,
  ListChecks,
  HelpCircle,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { Dialog } from '@/components/ui/dialog';
import { ActionItemCard } from '@/components/approvals/ActionItemCard';
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

export function MeetingDetailDrawer({
  meeting,
  isOpen,
  onClose,
  orgId,
  onMeetingUpdated,
}: MeetingDetailDrawerProps) {
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

  // Stage 14: Speakers State
  const [speakers, setSpeakers] = useState<SpeakerItem[]>([]);
  const [loadingSpeakers, setLoadingSpeakers] = useState(false);
  const [speakersError, setSpeakersError] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [editingSpeakerLabel, setEditingSpeakerLabel] = useState<string | null>(null);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<string>('');
  const [savingSpeakerMapping, setSavingSpeakerMapping] = useState(false);

  // Stage 14: Project Routing State
  const [candidates, setCandidates] = useState<CandidateProject[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [routingReasonInput, setRoutingReasonInput] = useState<string>('');
  const [routingSubmitting, setRoutingSubmitting] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [routingSuccess, setRoutingSuccess] = useState<string | null>(null);

  // Stage 14: Guest Consent State
  const [isResolvingGuestConsent, setIsResolvingGuestConsent] = useState(false);
  const [guestConsentNotes, setGuestConsentNotes] = useState('');
  const [guestConsentError, setGuestConsentError] = useState<string | null>(null);

  // Stage 15: AI Notes & Action Suggestions
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
        throw new Error(data.message || 'Failed to load notes');
      }
      setNotes(data.notes || null);
      setActionItems(data.actionItems || []);
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingNotes(false);
    }
  }, [orgId]);

  const jumpToCue = (seq: number) => {
    const el = document.getElementById(`seg-${seq}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-accent', 'bg-accent/20');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-accent', 'bg-accent/20');
      }, 3000);
    }
  };

  const fetchTranscript = useCallback(async (meetingId: string) => {
    setLoadingTranscript(true);
    setTranscriptError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/meetings/${meetingId}/transcript?limit=200`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to load transcript');
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
      if (meeting.status === 'transcript_ready' || meeting.status === 'awaiting_project_choice' || meeting.status === 'routed' || meeting.status === 'completed' || meeting.hasTranscript) {
        fetchTranscript(meeting.id);
        fetchSpeakers(meeting.id);
      }
      if (meeting.status === 'completed' || meeting.status === 'routed' || meeting.hasTranscript) {
        fetchNotes(meeting.id);
      }
      fetchCandidates(meeting.id);
      fetchMembers();
      setSelectedProjectId(meeting.nodeId || meeting.suggestedNodeId || '');
      setRoutingReasonInput('');
      setRoutingError(null);
      setRoutingSuccess(null);
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
    navigator.clipboard.writeText(meeting.providerMeetingUuid);
    setCopiedUuid(true);
    setTimeout(() => setCopiedUuid(false), 2000);
  };

  const handleCopyAnchor = (seg: NormalizedTranscriptSegment) => {
    const anchorUrl = `${window.location.origin}${window.location.pathname}#anchor-${seg.seq}`;
    navigator.clipboard.writeText(anchorUrl);
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
        throw new Error(data.message || 'Retry failed');
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
          throw new Error('Version conflict: The meeting was modified elsewhere. Please refresh and try again.');
        }
        if (res.status === 428) {
          throw new Error('Precondition Required: If-Match header missing.');
        }
        throw new Error(data.message || data.detail || 'Failed to skip meeting');
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
      setRoutingError('Please select a target project leaf');
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
          throw new Error('Version conflict: The meeting was modified concurrently. Please refresh.');
        }
        throw new Error(data.message || 'Failed to route meeting');
      }

      setRoutingSuccess('Meeting routed successfully to project!');
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
        throw new Error(data.message || 'Failed to update speaker mapping');
      }

      setEditingSpeakerLabel(null);
      await fetchSpeakers(meeting.id);
      await fetchTranscript(meeting.id);
      if (data.meeting && onMeetingUpdated) {
        onMeetingUpdated(data.meeting);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update speaker mapping');
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
        throw new Error(data.message || 'Failed to resolve guest consent');
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Notes &amp; Actions Extracted
          </span>
        );
      case 'routed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Routed to Project
          </span>
        );
      case 'awaiting_project_choice':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5" />
            Awaiting Project Choice
          </span>
        );
      case 'routing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <RotateCw className="w-3.5 h-3.5 animate-spin" />
            Routing Project...
          </span>
        );
      case 'transcript_ready':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Transcript Ready
          </span>
        );
      case 'ready_for_transcript_retrieval':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Clock className="w-3.5 h-3.5" />
            Ready for Retrieval
          </span>
        );
      case 'waiting_for_transcript':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3.5 h-3.5" />
            Waiting for Transcript
          </span>
        );
      case 'pending_consent':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            Pending Host Consent
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
            <Trash2 className="w-3.5 h-3.5" />
            Skipped &amp; Purged
          </span>
        );
      case 'connection_requires_reconnection':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <AlertTriangle className="w-3.5 h-3.5" />
            Reconnection Required
          </span>
        );
      case 'intake_failed':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertTriangle className="w-3.5 h-3.5" />
            Intake Failed
          </span>
        );
    }
  };

  const getMethodBadge = (method: string | null) => {
    switch (method) {
      case 'email_verified':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Verified Email
          </span>
        );
      case 'fuzzy_llm':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
            AI Disambiguated
          </span>
        );
      case 'manual':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
            Manual Override
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
            Unresolved
          </span>
        );
    }
  };

  const canRetry =
    meeting.status === 'intake_failed' ||
    meeting.status === 'pending_consent' ||
    meeting.status === 'connection_requires_reconnection';

  const canSkip = !meeting.skipped && meeting.status !== 'skipped';

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={meeting.title || 'Untitled Meeting'}
        description={`Zoom Meeting ID: ${meeting.providerNumericId || meeting.providerMeetingUuid}`}
        widthClass="max-w-2xl w-full"
      >
        <div className="space-y-6 text-sm text-foreground">
          {/* Status Section */}
          <div className="p-3.5 rounded-lg bg-panel-inset border border-border-subtle flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Lifecycle State:</span>
            {getStatusBadge(meeting.status)}
          </div>

          {/* Error Alert */}
          {meeting.intakeError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <div>
                <div className="font-semibold">Intake Notice / Reason</div>
                <div className="mt-0.5 text-rose-200/80">{meeting.intakeError}</div>
              </div>
            </div>
          )}

          {/* Guest Consent Attestation Banner */}
          {meeting.guestsPresent && meeting.guestConsentStatus !== 'consented' && (
            <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs space-y-2">
              <div className="font-semibold text-amber-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                External Guest Consent Required
              </div>
              <p className="text-amber-200/80 leading-relaxed">
                External participants attended this meeting. Confirm that proper recording and transcription notices
                were given before automated processing continues.
              </p>
              <div className="space-y-2 pt-1">
                <input
                  type="text"
                  placeholder="Attestation notes (e.g. Verbal consent confirmed)..."
                  value={guestConsentNotes}
                  onChange={(e) => setGuestConsentNotes(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-panel-inset border border-border-subtle text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
                />
                {guestConsentError && (
                  <div className="text-rose-400 text-[11px]">{guestConsentError}</div>
                )}
                <button
                  type="button"
                  onClick={handleResolveGuestConsent}
                  disabled={isResolvingGuestConsent}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-xs border border-amber-500/30 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {isResolvingGuestConsent && <RotateCw className="w-3 h-3 animate-spin" />}
                  Confirm Guest Consent Provided
                </button>
              </div>
            </div>
          )}

          {/* Stage 15: AI Notes & Action Suggestions */}
          {(notes || loadingNotes || actionItems.length > 0) && (
            <div className="p-4 rounded-xl bg-panel-inset border border-border-subtle space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  Meeting Notes &amp; Action Suggestions
                </h3>
                {notes && (
                  <span className="text-[10px] font-mono text-muted-foreground bg-panel px-2 py-0.5 rounded border border-border-subtle">
                    Model: {notes.model} (v{notes.promptVersion})
                  </span>
                )}
              </div>

              {loadingNotes ? (
                <div className="p-4 text-center text-xs text-muted-foreground bg-panel rounded-lg flex items-center justify-center gap-2">
                  <RotateCw className="w-3.5 h-3.5 animate-spin text-accent" />
                  Loading meeting notes &amp; suggestions...
                </div>
              ) : notesError ? (
                <div className="p-2.5 text-xs text-rose-400 bg-rose-500/10 rounded-lg">
                  {notesError}
                </div>
              ) : (
                <>
                  {/* Executive Summary */}
                  {notes?.summaryMd && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <FileText className="w-3 h-3 text-accent" />
                        Executive Summary
                      </div>
                      <div className="p-3 rounded-lg bg-panel border border-border-subtle text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                        {notes.summaryMd}
                      </div>
                    </div>
                  )}

                  {/* Key Decisions */}
                  {notes && notes.decisions && notes.decisions.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        Key Decisions ({notes.decisions.length})
                      </div>
                      <div className="space-y-2">
                        {notes.decisions.map((dec, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-panel border border-border-subtle space-y-1.5 text-xs"
                          >
                            <div className="font-medium text-foreground">{dec.text}</div>
                            {dec.evidence && dec.evidence.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-0.5">
                                {dec.evidence.map((ev, evIdx) => (
                                  <button
                                    key={evIdx}
                                    type="button"
                                    onClick={() => jumpToCue(ev.seq)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 transition-colors"
                                    title={`Jump to Cue #${ev.seq}`}
                                  >
                                    <ExternalLink className="w-2.5 h-2.5" />
                                    Cue #{ev.seq}: &quot;{ev.quote.slice(0, 40)}...&quot;
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Open Questions */}
                  {notes && notes.openQuestions && notes.openQuestions.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <HelpCircle className="w-3 h-3 text-amber-400" />
                        Open Questions ({notes.openQuestions.length})
                      </div>
                      <div className="space-y-1.5">
                        {notes.openQuestions.map((q, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-panel border border-border-subtle text-xs text-foreground/90"
                          >
                            • {q.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggested actions with human decisions (Requirement N-2) */}
                  {actionItems.length > 0 && (() => {
                    const validItems = actionItems.filter((i) => i.validationStatus !== 'invalid_evidence');
                    const invalidItems = actionItems.filter((i) => i.validationStatus === 'invalid_evidence');
                    const pending = validItems.filter((i) => i.state === 'suggested').length;

                    return (
                      <div className="space-y-3">
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <ListChecks className="w-3.5 h-3.5 text-sky-400" />
                            Suggested Actions ({pending} awaiting decision)
                          </span>
                          <span className="text-[10px] text-muted-foreground normal-case tracking-normal">
                            Tasks change only after a human decision
                          </span>
                        </div>

                        <div className="space-y-2.5">
                          {validItems.map((item) => (
                            <ActionItemCard
                              key={item.id}
                              item={item}
                              orgId={orgId}
                              onJumpToCue={jumpToCue}
                              onItemChange={(updated) =>
                                setActionItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
                              }
                            />
                          ))}
                        </div>

                        {/* Excluded Invalid Evidence Items */}
                        {invalidItems.length > 0 && (
                          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 space-y-2 text-xs">
                            <div className="flex items-center gap-1.5 text-rose-400 font-semibold text-[11px]">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>Filtered Out Proposals ({invalidItems.length}) — Invalid Evidence Grounding</span>
                            </div>
                            <p className="text-[10px] text-rose-300/80">
                              These items were extracted by the LLM but failed strict contiguous token verification against the canonical transcript cues. They are excluded from the human review queue.
                            </p>
                            <div className="space-y-1.5">
                              {invalidItems.map((inv) => (
                                <div key={inv.id} className="p-2 rounded bg-panel/60 border border-rose-500/20 text-[11px] space-y-1">
                                  <div className="font-medium text-foreground line-through opacity-70">
                                    {inv.text}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground font-mono">
                                    Failed Quote: &quot;{inv.evidence?.[0]?.quote || 'N/A'}&quot;
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* Stage 14: Project Routing & AskHost Controls */}
          {(meeting.status === 'awaiting_project_choice' || meeting.status === 'routed' || meeting.status === 'transcript_ready') && (
            <div className="p-4 rounded-xl bg-panel-inset border border-border-subtle space-y-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <FolderKanban className="w-3.5 h-3.5 text-accent" />
                  Project Routing
                </h3>
                {meeting.routingConfidence !== null && meeting.routingConfidence !== undefined && (
                  <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                    meeting.routingConfidence >= 0.70
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {Math.round(meeting.routingConfidence * 100)}% Confidence
                  </span>
                )}
              </div>

              {/* AI Routing Suggestion Info */}
              {meeting.suggestedNodeId && (
                <div className="p-3 rounded-lg bg-panel border border-border-subtle text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                    <span>AI Recommendation:</span>
                    <span className="font-semibold text-foreground">
                      {candidates.find((c) => c.id === meeting.suggestedNodeId)?.name || 'Project Node'}
                    </span>
                  </div>
                  {meeting.routingReason && (
                    <p className="text-[11px] text-muted-foreground/90 italic pl-5">
                      &quot;{meeting.routingReason}&quot;
                    </p>
                  )}
                </div>
              )}

              {/* Route Selection Form */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-muted-foreground block">
                  {meeting.status === 'routed' ? 'Current Project Leaf:' : 'Select Target Project Leaf:'}
                </label>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    disabled={routingSubmitting || loadingCandidates}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-panel border border-border-subtle text-xs text-foreground focus:outline-none focus:border-accent"
                  >
                    <option value="">-- Choose Project Leaf --</option>
                    {candidates.map((cand) => (
                      <option key={cand.id} value={cand.id}>
                        {cand.teamName ? `[${cand.teamName}] ` : ''}{cand.name} ({cand.path})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleRouteMeeting}
                    disabled={routingSubmitting || !selectedProjectId}
                    className="px-3.5 py-1.5 rounded-lg bg-accent text-accent-foreground font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-accent/90 transition-colors disabled:opacity-50"
                  >
                    {routingSubmitting ? <RotateCw className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                    {meeting.status === 'routed' ? 'Update Route' : 'Confirm Project Route'}
                  </button>
                </div>

                {routingError && (
                  <div className="text-xs text-rose-400 p-2 rounded bg-rose-500/10 border border-rose-500/20">
                    {routingError}
                  </div>
                )}
                {routingSuccess && (
                  <div className="text-xs text-emerald-400 p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                    {routingSuccess}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stage 14: Speaker Resolution Section */}
          {(speakers.length > 0 || loadingSpeakers) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Speaker Resolution ({speakers.length} speakers)
                </h3>
              </div>

              {loadingSpeakers ? (
                <div className="p-4 text-center text-xs text-muted-foreground bg-panel-inset rounded-lg">
                  <RotateCw className="w-3.5 h-3.5 animate-spin mx-auto mb-1 text-accent" />
                  Loading speaker resolutions...
                </div>
              ) : speakersError ? (
                <div className="p-2.5 text-xs text-rose-400 bg-rose-500/10 rounded-lg">
                  {speakersError}
                </div>
              ) : (
                <div className="space-y-2">
                  {speakers.map((spk) => {
                    const isEditing = editingSpeakerLabel === spk.speakerLabel;
                    return (
                      <div
                        key={spk.speakerLabel}
                        className="p-2.5 rounded-lg bg-panel-inset border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground px-2 py-0.5 rounded text-[11px] bg-accent/10 text-accent border border-accent/20">
                              {spk.speakerLabel}
                            </span>
                            {getMethodBadge(spk.resolutionMethod)}
                          </div>
                          <div className="text-muted-foreground text-[11px]">
                            {spk.userName ? (
                              <span>
                                {spk.userName} <span className="text-muted-foreground/60">({spk.userEmail})</span>
                              </span>
                            ) : (
                              <span className="italic text-zinc-500">Unassigned / Guest</span>
                            )}
                          </div>
                        </div>

                        {/* Edit Control */}
                        <div>
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={selectedUserForEdit}
                                onChange={(e) => setSelectedUserForEdit(e.target.value)}
                                className="px-2 py-1 rounded bg-panel border border-border-subtle text-xs text-foreground focus:outline-none"
                              >
                                <option value="">Unassigned</option>
                                {members.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name} ({m.email})
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={handleSaveSpeakerMapping}
                                disabled={savingSpeakerMapping}
                                className="px-2 py-1 rounded bg-accent text-accent-foreground font-semibold text-[11px] disabled:opacity-50"
                              >
                                {savingSpeakerMapping ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingSpeakerLabel(null)}
                                className="px-2 py-1 rounded border border-border-subtle text-muted-foreground text-[11px]"
                              >
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
                              className="text-[11px] text-accent hover:underline font-medium"
                            >
                              Edit Mapping
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Normalized Transcript Segments Section */}
          {segments.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Canonical Transcript ({segments.length} segments)
                </h3>
                <span className="text-[11px] font-mono text-muted-foreground">
                  Anchors: 1..{segments.length}
                </span>
              </div>

              {/* Search Filter */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter transcript cues or search speaker..."
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-panel-inset border border-border-subtle text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
                />
              </div>

              {/* Transcript Display Box */}
              {loadingTranscript ? (
                <div className="p-8 text-center text-xs text-muted-foreground bg-panel-inset rounded-lg border border-border-subtle flex flex-col items-center gap-2">
                  <RotateCw className="w-4 h-4 animate-spin text-accent" />
                  Loading normalized transcript...
                </div>
              ) : transcriptError ? (
                <div className="p-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                  {transcriptError}
                </div>
              ) : filteredSegments.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground bg-panel-inset rounded-lg border border-border-subtle">
                  No cues match the filter criteria.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {filteredSegments.map((seg) => (
                    <div
                      key={seg.seq}
                      id={`seg-${seg.seq}`}
                      className="p-3 rounded-lg bg-panel-inset border border-border-subtle hover:border-accent/30 transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground bg-panel px-1.5 py-0.5 rounded border border-border-subtle flex items-center gap-0.5">
                            <Hash className="w-2.5 h-2.5" />
                            {seg.seq}
                          </span>
                          <span className="font-semibold text-foreground px-2 py-0.5 rounded-full text-[11px] bg-accent/15 text-accent border border-accent/20">
                            {seg.speakerLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {formatMsToTimestamp(seg.startMs)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyAnchor(seg)}
                            className="p-1 text-muted-foreground hover:text-accent rounded transition-colors"
                            title="Copy anchor link to timestamp"
                          >
                            {copiedAnchorSeq === seg.seq ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-foreground/90 leading-relaxed pl-1 whitespace-pre-wrap">
                        {seg.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Meeting Metadata Details */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Meeting Information
            </h3>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded bg-panel-inset border border-border-subtle">
                <span className="text-muted-foreground block text-[11px]">Provider</span>
                <span className="font-medium capitalize">{meeting.provider}</span>
              </div>

              <div className="p-2.5 rounded bg-panel-inset border border-border-subtle">
                <span className="text-muted-foreground block text-[11px]">Duration</span>
                <span className="font-medium">
                  {meeting.durationSeconds ? `${Math.round(meeting.durationSeconds / 60)} mins` : '—'}
                </span>
              </div>

              <div className="p-2.5 rounded bg-panel-inset border border-border-subtle col-span-2">
                <span className="text-muted-foreground block text-[11px]">Host</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium font-mono text-[11px]">
                    {meeting.zoomHostEmail || meeting.zoomHostId || 'Unknown Host'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded bg-panel-inset border border-border-subtle col-span-2">
                <span className="text-muted-foreground block text-[11px]">Start Time</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>
                    {meeting.actualStartAt ? new Date(meeting.actualStartAt).toLocaleString() : '—'}
                    {meeting.timezone ? ` (${meeting.timezone})` : ''}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded bg-panel-inset border border-border-subtle col-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-[11px]">Provider UUID</span>
                  <button
                    type="button"
                    onClick={handleCopyUuid}
                    className="text-[11px] text-accent hover:underline flex items-center gap-1"
                  >
                    {copiedUuid ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedUuid ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <span className="font-mono text-[10px] break-all text-muted-foreground mt-0.5 block">
                  {meeting.providerMeetingUuid}
                </span>
              </div>
            </div>
          </div>

          {/* Media Readiness Flags */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Media Availability &amp; Retention
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded bg-panel-inset border border-border-subtle flex items-center justify-between">
                <span>Cloud Recording</span>
                <span className={meeting.hasRecording ? 'text-emerald-400 font-semibold' : 'text-muted-foreground'}>
                  {meeting.hasRecording ? 'Available' : 'None'}
                </span>
              </div>
              <div className="p-2.5 rounded bg-panel-inset border border-border-subtle flex items-center justify-between">
                <span>Audio Transcript</span>
                <span className={meeting.hasTranscript ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                  {meeting.hasTranscript ? 'Available' : 'Pending'}
                </span>
              </div>
              {meeting.transcriptRetentionDeadline && (
                <div className="p-2.5 rounded bg-panel-inset border border-border-subtle col-span-2 flex items-center justify-between">
                  <span>Retention Deadline (180 days)</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {new Date(meeting.transcriptRetentionDeadline).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Actions Section: Retry and Skip */}
          <div className="pt-4 border-t border-border-subtle space-y-3">
            {retryError && (
              <div className="text-xs text-rose-400 p-2 rounded bg-rose-500/10 border border-rose-500/20">
                {retryError}
              </div>
            )}

            {canRetry && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground font-semibold text-xs hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                <RotateCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
                {retrying ? 'Evaluating Consent & State...' : 'Re-evaluate Meeting Intake'}
              </button>
            )}

            {canSkip && (
              <button
                type="button"
                onClick={() => setIsSkipModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 font-semibold text-xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Skip Meeting &amp; Purge Data
              </button>
            )}

            {meeting.skipped && (
              <div className="p-2.5 rounded-lg bg-panel-inset border border-border-subtle text-center text-xs text-muted-foreground">
                This meeting was skipped. All transcript segments and AI artifacts have been purged.
              </div>
            )}
          </div>
        </div>
      </Drawer>

      {/* Confirmation Modal for Skip & Purge */}
      <Dialog
        isOpen={isSkipModalOpen}
        onClose={() => !skipping && setIsSkipModalOpen(false)}
        title="Skip Meeting and Purge Artifacts"
        description="Permanently delete ingested data and fence background workers."
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4 text-xs text-foreground">
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 space-y-1.5 leading-relaxed">
            <p className="font-semibold flex items-center gap-1.5 text-rose-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Irreversible Action
            </p>
            <p>
              Skipping this meeting will increment its processing generation to fence any in-flight workers,
              permanently purge all database transcript segments and action items, and delete the raw audio
              transcript file from storage.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="skip-reason" className="font-medium text-foreground block">
              Reason for skipping (optional):
            </label>
            <input
              id="skip-reason"
              type="text"
              placeholder="e.g. Private conversation, irrelevant sync..."
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              disabled={skipping}
              className="w-full px-3 py-2 rounded-lg bg-panel-inset border border-border-subtle text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
            />
          </div>

          {skipError && (
            <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400">
              {skipError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => setIsSkipModalOpen(false)}
              disabled={skipping}
              className="px-3 py-1.5 rounded-lg border border-border-subtle text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSkipMeeting}
              disabled={skipping}
              className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {skipping && <RotateCw className="w-3.5 h-3.5 animate-spin" />}
              {skipping ? 'Purging Artifacts...' : 'Confirm Skip & Purge'}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
