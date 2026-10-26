'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FileQuestion } from 'lucide-react';
import type { DocDTO } from '@workspace/core';
import { DocEditor } from './DocEditor';
import { EmptyState, ErrorState } from '@/components/ui/states';

/** Loads one doc and shows the editor, with loading, not-found and error states. */
export function DocDetail({ orgId, docId, backHref }: { orgId: string; docId: string; backHref: string }) {
  const [doc, setDoc] = useState<DocDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/orgs/${orgId}/docs/${docId}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "This doc couldn't be loaded.");
      }
      setDoc(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, docId]);

  useEffect(() => {
    if (orgId && docId) load();
  }, [orgId, docId, load]);

  if (loading && !doc) {
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <span className="sr-only">Loading doc…</span>
        <div className="skeleton h-7 w-72 max-w-full" />
        <div className="skeleton h-3.5 w-96 max-w-full" />
        <div className="card h-[28rem]" />
      </div>
    );
  }

  if (notFound) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="This doc isn't available"
        description="It may have been archived, or it belongs to a private project you're not a member of."
        action={{ label: 'Back to docs', href: backHref }}
      />
    );
  }

  if (error || !doc) {
    return <ErrorState title="Couldn't open this doc" message={error} onRetry={load} />;
  }

  return <DocEditor initialDoc={doc} orgId={orgId} backHref={backHref} onDocUpdated={setDoc} />;
}
