'use client';

import React, { useState } from 'react';
import { Video, Sparkles, CheckCircle2 } from 'lucide-react';
import { TableShell } from '@/components/ui/table-shell';

interface MeetingItem {
  id: string;
  topic: string;
  hostName: string;
  startTime: string;
  durationMinutes: number;
  status: 'transcribed' | 'processing' | 'approved';
  actionItemsCount: number;
}

const INITIAL_MEETINGS: MeetingItem[] = [
  {
    id: 'mtg-1',
    topic: 'Architecture A to B Migration Planning Sync',
    hostName: 'Alex Mercer',
    startTime: '2026-10-05 14:30 IST',
    durationMinutes: 45,
    status: 'transcribed',
    actionItemsCount: 4,
  },
  {
    id: 'mtg-2',
    topic: 'Design Partner Feedback & Onboarding Check-in',
    hostName: 'Priya Sharma',
    startTime: '2026-10-04 11:00 IST',
    durationMinutes: 30,
    status: 'approved',
    actionItemsCount: 3,
  },
  {
    id: 'mtg-3',
    topic: 'PostgreSQL RLS Invariant Verification Review',
    hostName: 'Alex Mercer',
    startTime: '2026-10-03 16:00 IST',
    durationMinutes: 60,
    status: 'approved',
    actionItemsCount: 5,
  },
];

export default function MeetingsPage() {
  const [meetings] = useState<MeetingItem[]>(INITIAL_MEETINGS);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
            Meetings & Transcripts
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Zoom meetings, transcript ingestion, and evidence-grounded action item proposals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-accent bg-accent/15 px-2.5 py-1 rounded-lg border border-accent/30">
            Zoom Webhook Intake: Stage 12 Ready
          </span>
        </div>
      </div>

      <TableShell>
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-panel-inset border-b border-border-subtle text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
              <th className="py-3 px-4">Topic & Meeting ID</th>
              <th className="py-3 px-4">Host</th>
              <th className="py-3 px-4">Date & Time (IST)</th>
              <th className="py-3 px-4">Duration</th>
              <th className="py-3 px-4">AI Notes Status</th>
              <th className="py-3 px-4">Action Items</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/60">
            {meetings.map((m) => (
              <tr key={m.id} className="hover:bg-panel-elevated/40 transition-colors">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-panel-inset border border-border-subtle flex items-center justify-center text-accent">
                      <Video className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">{m.topic}</div>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {m.id}
                      </span>
                    </div>
                  </div>
                </td>

                <td className="py-3 px-4 text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-[9px] font-bold text-accent">
                      {m.hostName.charAt(0)}
                    </div>
                    <span>{m.hostName}</span>
                  </div>
                </td>

                <td className="py-3 px-4 text-muted-foreground font-mono text-[11px]">
                  {m.startTime}
                </td>

                <td className="py-3 px-4 text-muted-foreground font-mono text-[11px]">
                  {m.durationMinutes} mins
                </td>

                <td className="py-3 px-4">
                  {m.status === 'approved' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="w-3 h-3" />
                      Approved
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent/15 text-accent border border-accent/30">
                      <Sparkles className="w-3 h-3" />
                      Extracted
                    </span>
                  )}
                </td>

                <td className="py-3 px-4">
                  <span className="font-mono font-bold text-[11px] text-foreground">
                    {m.actionItemsCount} items
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}
