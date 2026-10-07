'use client';

import React, { useEffect, useState, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function ZoomOAuthCallbackPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<'exchanging' | 'success' | 'error'>('exchanging');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMessage(`Zoom returned error: ${error}`);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setErrorMessage('Missing authorization code or state in callback.');
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
          throw new Error(body.message || body.detail || `Callback failed with HTTP ${res.status}`);
        }

        setStatus('success');
        setTimeout(() => {
          router.push(`/orgs/${orgId}/settings`);
        }, 1500);
      } catch (err: unknown) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Unknown callback error occurred');
      }
    }

    completeOAuth();
  }, [orgId, router, searchParams]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-panel border border-border-subtle rounded-2xl p-6 space-y-4 text-center">
        {status === 'exchanging' && (
          <div className="space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto" />
            <h2 className="text-sm font-bold text-foreground">
              Connecting Zoom Account...
            </h2>
            <p className="text-xs text-muted-foreground">
              Verifying cryptographic state and securely storing credentials in managed secret store.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <h2 className="text-sm font-bold text-foreground">
              Zoom Successfully Connected!
            </h2>
            <p className="text-xs text-muted-foreground">
              Account identity resolved and hosts synchronized. Redirecting to settings...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
            <h2 className="text-sm font-bold text-foreground">
              Connection Failed
            </h2>
            <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
              {errorMessage}
            </p>
            <div className="pt-2">
              <Link
                href={`/orgs/${orgId}/settings`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-panel-elevated border border-border-subtle hover:bg-border-subtle text-xs font-semibold text-foreground transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Settings</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
