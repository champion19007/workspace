'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileQuestion, ArrowLeft } from 'lucide-react';
import { DocEditor } from '@/components/docs/DocEditor';
import { EmptyState } from '@/components/ui/table-shell';
import type { DocDTO } from '@workspace/core';

export default function ProjectDocDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params?.orgId as string;
  const projectId = params?.projectId as string;
  const docId = params?.docId as string;

  const [doc, setDoc] = useState<DocDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !docId) return;

    let mounted = true;
    const fetchDoc = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/orgs/${orgId}/docs/${docId}`);
        if (res.status === 404) {
          throw new Error('DOCUMENT_NOT_FOUND');
        }
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to load document');
        }
        const data: DocDTO = await res.json();
        if (mounted) {
          setDoc(data);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchDoc();
    return () => {
      mounted = false;
    };
  }, [orgId, docId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3 animate-pulse">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-muted-foreground">Loading document and version history...</p>
      </div>
    );
  }

  if (error === 'DOCUMENT_NOT_FOUND' || !doc) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FileQuestion}
          title="Document not found"
          description="The requested document does not exist, has been archived, or you lack permissions to view it."
          action={{
            label: '← Back to Project Documents',
            onClick: () => router.push(`/orgs/${orgId}/projects/${projectId}/docs`),
          }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-4">
        <Link
          href={`/orgs/${orgId}/projects/${projectId}/docs`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Project Documents</span>
        </Link>
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <DocEditor
        initialDoc={doc}
        orgId={orgId}
        backHref={`/orgs/${orgId}/projects/${projectId}/docs`}
        onDocUpdated={(updated) => setDoc(updated)}
      />
    </div>
  );
}
