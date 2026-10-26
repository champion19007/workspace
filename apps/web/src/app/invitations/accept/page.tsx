'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { UserCheck, ArrowRight, AlertCircle } from 'lucide-react';
import Link from 'next/link';

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') || '';

  const [loading, setLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setCurrentUser({ id: data.session.userId, email: data.session.email });
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setSessionLoading(false);
      }
    }
    checkAuth();
  }, []);

  const handleAccept = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to accept invitation');
      }

      router.push(`/orgs/${data.org.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while accepting');
    } finally {
      setLoading(false);
    }
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-canvas text-fg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  const returnUrl = `/invitations/accept?token=${encodeURIComponent(token)}`;

  return (
    <div className="min-h-screen bg-canvas text-fg flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-accent-subtle border border-accent/40 text-accent-text mb-6 shadow-md">
          <UserCheck className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Join Organisation</h1>
        <p className="mt-2 text-xs text-fg-muted">
          You have been invited to collaborate in Workspace v1.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-surface border border-border py-8 px-6 shadow-2xl rounded-xl sm:px-10 space-y-6">
          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-danger-subtle border border-danger/20 text-danger text-xs flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!token ? (
            <div className="text-center text-xs text-fg-muted">
              No invitation token provided. Please check the invitation link.
            </div>
          ) : currentUser ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-surface-2 border border-border text-xs text-fg-muted">
                Signed in as: <strong className="text-fg font-mono">{currentUser.email}</strong>
              </div>

              <button
                onClick={handleAccept}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-accent hover:opacity-90 disabled:opacity-50 text-xs font-semibold text-accent-fg shadow-md transition-opacity"
              >
                {loading ? (
                  <span>Joining organisation...</span>
                ) : (
                  <>
                    <span>Accept Invitation &amp; Join</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <p className="text-xs text-fg-muted">
                You must sign in to accept this invitation. Your signed-in email address must match the invitation recipient.
              </p>

              <Link
                href={`/auth/login?returnTo=${encodeURIComponent(returnUrl)}`}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-accent hover:opacity-90 text-xs font-semibold text-accent-fg shadow-md transition-opacity"
              >
                <span>Sign in to Accept</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-canvas text-fg flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      }
    >
      <AcceptInvitationContent />
    </Suspense>
  );
}
