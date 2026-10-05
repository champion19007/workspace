'use client';

import React, { useState } from 'react';
import { Inbox, CheckCircle2, XCircle, Sparkles, Quote } from 'lucide-react';
import { EmptyState } from '@/components/ui/table-shell';

interface SuggestionItem {
  id: string;
  meetingTopic: string;
  proposedTitle: string;
  proposedAssignee: string;
  evidenceQuote: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected';
}

const INITIAL_SUGGESTIONS: SuggestionItem[] = [
  {
    id: 'sug-1',
    meetingTopic: 'Architecture A to B Migration Planning Sync',
    proposedTitle: 'Verify pgvector cosine similarity index performance under load',
    proposedAssignee: 'Alex Mercer',
    evidenceQuote: '“Alex, can you benchmark pgvector indexing before we finalize the vector chunk size?”',
    confidence: 0.94,
    status: 'pending',
  },
  {
    id: 'sug-2',
    meetingTopic: 'Design Partner Feedback & Onboarding Check-in',
    proposedTitle: 'Configure 30-day session rolling refresh cookie verification',
    proposedAssignee: 'Priya Sharma',
    evidenceQuote: '“Priya will audit the rolling session window so users don’t get logged out mid-week.”',
    confidence: 0.98,
    status: 'pending',
  },
];

export default function InboxPage() {
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>(INITIAL_SUGGESTIONS);

  const handleAction = (id: string, action: 'approved' | 'rejected') => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: action } : s))
    );
  };

  const pendingCount = suggestions.filter((s) => s.status === 'pending').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-accent/20 text-accent">
            Human-in-the-Loop
          </span>
          <span className="text-xs text-muted-foreground">• Explicit Approvals Required</span>
        </div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
          Approvals & Notifications Inbox
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Review evidence-backed AI action-item proposals before they are converted to project tasks.
        </p>
      </div>

      {pendingCount === 0 ? (
        <EmptyState
          icon={Inbox}
          title="All caught up!"
          description="There are no pending action items or meeting notes awaiting your human approval."
        />
      ) : (
        <div className="space-y-4">
          {suggestions
            .filter((s) => s.status === 'pending')
            .map((item) => (
              <div
                key={item.id}
                className="p-5 rounded-2xl bg-panel border border-border-subtle hover:border-accent/40 transition-all space-y-4 shadow-sm"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    <span className="text-xs font-semibold text-muted-foreground">
                      Extracted from: <strong className="text-foreground">{item.meetingTopic}</strong>
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 self-start sm:self-auto">
                    Confidence: {Math.round(item.confidence * 100)}%
                  </span>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-foreground mb-1">
                    {item.proposedTitle}
                  </h3>
                  <div className="text-xs text-muted-foreground">
                    Proposed Assignee: <strong className="text-foreground">{item.proposedAssignee}</strong>
                  </div>
                </div>

                {/* Evidence Quote */}
                <div className="p-3 rounded-xl bg-panel-inset border border-border-subtle flex items-start gap-2.5 text-xs text-muted-foreground italic">
                  <Quote className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <p>{item.evidenceQuote}</p>
                </div>

                {/* Human Decision Buttons */}
                <div className="pt-2 border-t border-border-subtle flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Tasks are never written to the DB without your approval.
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAction(item.id, 'rejected')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle hover:bg-rose-500/10 hover:text-rose-400 text-xs text-muted-foreground transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>

                    <button
                      onClick={() => handleAction(item.id, 'approved')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent text-accent-foreground font-bold text-xs shadow-md hover:opacity-90 transition-opacity"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve as Task</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
