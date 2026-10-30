'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Link2Off, Loader2, UserPlus } from 'lucide-react';
import { AuthFrame, AuthFrameFallback } from '@/components/ui/auth-frame';
import { Avatar } from '@/components/ui/avatar';
import { Alert } from '@/components/ui/states';

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
          if (data.authenticated && data.user) setCurrentUser({ id: data.user.id, email: data.user.email });
        }
      } catch {
        // Treated as signed out: the sign-in button below is the way forward either way.
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
      if (!res.ok) throw new Error(data.message || "This invitation couldn't be accepted.");

      router.push(`/orgs/${data.org.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setCurrentUser(null);
    setError(null);
  };

  if (!token) {
    return (
      <AuthFrame
        icon={Link2Off}
        tone="warning"
        title="This invitation link is incomplete"
        description="Open the link from your invitation email again, or ask the person who invited you to send a new one."
      >
        <Link href="/orgs" className="btn btn-secondary w-full">
          Go to Workspace
        </Link>
      </AuthFrame>
    );
  }

  const returnUrl = `/invitations/accept?token=${encodeURIComponent(token)}`;

  return (
    <AuthFrame
      icon={UserPlus}
      title="You've been invited"
      description={
        currentUser
          ? 'Accept to join the organization and see its projects, tasks and meeting notes.'
          : 'Sign in with the email address the invitation was sent to.'
      }
    >
      {sessionLoading ? (
        <div className="space-y-3" role="status" aria-busy="true">
          <span className="sr-only">Checking whether you&apos;re signed in…</span>
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-9 w-full" />
        </div>
      ) : currentUser ? (
        <>
          <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
            <Avatar name={currentUser.email} size="sm" />
            <div className="min-w-0 text-sm">
              <p className="text-fg-muted">Signed in as</p>
              <p className="truncate font-medium text-fg">{currentUser.email}</p>
            </div>
          </div>

          {error && <Alert tone="danger">{error}</Alert>}

          <button type="button" onClick={handleAccept} disabled={loading} className="btn btn-primary w-full">
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading ? 'Joining…' : 'Accept invitation'}
          </button>
          <p className="text-center text-sm text-fg-muted">
            Invitation for someone else?{' '}
            <button type="button" onClick={signOut} className="link">
              Use another account
            </button>
          </p>
        </>
      ) : (
        <Link href={`/auth/login?returnTo=${encodeURIComponent(returnUrl)}`} className="btn btn-primary w-full">
          Sign in to accept
        </Link>
      )}
    </AuthFrame>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={<AuthFrameFallback />}>
      <AcceptInvitationContent />
    </Suspense>
  );
}
