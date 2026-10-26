'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';

// The assistant isn't built yet; this page used to fake answers, which is worse than saying so.
export default function AskAiPage() {
  const orgId = useParams()?.orgId as string;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Ask AI" description="Questions about your meetings, notes and tasks, answered with links to the sources." />
      <EmptyState
        icon={Sparkles}
        title="Ask AI isn't available yet"
        description="Until it is, meeting notes, docs and tasks are all searchable from their pages, or press Ctrl K to jump anywhere."
        action={{ label: 'Go to meetings', href: `/orgs/${orgId}/meetings` }}
      />
    </div>
  );
}
