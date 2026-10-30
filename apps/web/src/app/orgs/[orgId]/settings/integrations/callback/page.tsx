'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

export default function ZoomOAuthCallbackPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const settingsHref = `/orgs/${orgId}/settings?tab=integrations`;

  const [status, setStatus] = useState<'exchanging' | 'success' | 'error'>('exchanging');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMessage(error === 'access_denied' ? 'Access was declined in Zoom.' : `Zoom returned an error: ${error}`);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setErrorMessage('The link from Zoom is missing some details. Start connecting again from Settings.');
      return;
    }

    async function completeOAuth() {
      try {
        const res = await fetch(`/api/orgs/${orgId}/integrations/zoom/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || body.detail || `Connecting failed (HTTP ${res.status}).`);
        }

        setStatus('success');
        setTimeout(() => router.push(settingsHref), 1500);
      } catch (err: unknown) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Something went wrong while connecting Zoom.');
      }
    }

    completeOAuth();
  }, [orgId, router, searchParams, settingsHref]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-md p-6 text-center" aria-live="polite">
        {status === 'exchanging' && (
          <div className="space-y-2">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent-text" aria-hidden="true" />
            <h1 className="font-semibold text-fg">Connecting Zoom…</h1>
            <p className="text-sm text-fg-muted">Finishing sign-in with Zoom. This takes a few seconds.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-2">
            <CheckCircle2 className="mx-auto h-8 w-8 text-success" aria-hidden="true" />
            <h1 className="font-semibold text-fg">Zoom is connected</h1>
            <p className="text-sm text-fg-muted">
              Taking you back to <Link href={settingsHref} className="link">Settings</Link>…
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-2" role="alert">
            <AlertTriangle className="mx-auto h-8 w-8 text-danger" aria-hidden="true" />
            <h1 className="font-semibold text-fg">Couldn&apos;t connect Zoom</h1>
            <p className="pb-2 text-sm text-fg-muted">{errorMessage}</p>
            <Link href={settingsHref} className="btn btn-secondary">
              Back to Settings
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
