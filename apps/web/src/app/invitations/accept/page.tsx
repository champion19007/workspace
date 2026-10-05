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
          setCurrentUser(data.user);
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
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const returnUrl = `/invitations/accept?token=${encodeURIComponent(token)}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 mb-6">
          <UserCheck className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Join Organisation</h1>
        <p className="mt-2 text-sm text-slate-400">
          You have been invited to collaborate in Workspace v1.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 space-y-6">
          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-red-950/50 border border-red-800 text-red-200 text-sm flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!token ? (
            <div className="text-center text-sm text-slate-400">
              No invitation token provided. Please check the invitation link.
            </div>
          ) : currentUser ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300">
                Signed in as: <strong className="text-white">{currentUser.email}</strong>
              </div>

              <button
                onClick={handleAccept}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold text-white shadow-sm transition-colors"
              >
                {loading ? (
                  <span>Joining organisation...</span>
                ) : (
                  <>
                    <span>Accept Invitation & Join</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <p className="text-xs text-slate-400">
                You must sign in to accept this invitation. Your signed-in email address must match the invitation recipient.
              </p>

              <Link
                href={`/auth/login?returnTo=${encodeURIComponent(returnUrl)}`}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white shadow-sm transition-colors"
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
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      }
    >
      <AcceptInvitationContent />
    </Suspense>
  );
}
