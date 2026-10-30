'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail } from 'lucide-react';
import { AuthFrame, AuthFrameFallback } from '@/components/ui/auth-frame';
import { Alert } from '@/components/ui/states';

/** The code in the same email works in any browser, unlike the link (which needs the one that asked for it). */
function CodeForm({ email, returnTo }: { email: string; returnTo: string | null }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, returnTo: returnTo ?? undefined }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok && body?.redirectTo) {
      window.location.assign(body.redirectTo);
      return;
    }
    setError(body?.detail ?? "We couldn't check the code. Please try again.");
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="sign-in-code" className="label">
        Or enter the 6-digit code from the email
      </label>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <input
          id="sign-in-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="field min-w-0 flex-1 tracking-widest"
        />
        <button type="submit" disabled={busy || code.length !== 6} className="btn btn-primary shrink-0">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  );
}

function VerifyRequestContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const devSignIn = new URLSearchParams({ token: 'valid-mock-token', email });
  const returnTo = searchParams.get('returnTo');
  if (returnTo) devSignIn.set('returnTo', returnTo);

  return (
    <AuthFrame
      icon={Mail}
      title="Check your email"
      description={
        <>
          We sent a sign-in link to {email ? <strong className="font-medium text-fg">{email}</strong> : 'your email'}. It can be
          used once and expires after a short while.
        </>
      }
      footer={
        <>
          Wrong address or no email after a few minutes?{' '}
          <Link href="/auth/login" className="link">
            Try again
          </Link>
        </>
      }
    >
      <p className="text-sm text-fg-muted">
        Open the email from Workspace and select the link. If it isn&apos;t in your inbox, check your spam folder.
      </p>

      {email && <CodeForm email={email} returnTo={returnTo} />}

      {process.env.NODE_ENV !== 'production' && (
        <div className="rounded-lg border border-dashed border-border-strong p-3 text-sm">
          <p className="mb-2 text-fg-muted">Local development uses mock sign-in, so no email is sent. The code 123456 works too.</p>
          <a
            href={`/api/auth/callback?${devSignIn}`}
            className="btn btn-secondary btn-sm w-full"
          >
            Sign in as {email || 'this user'}
          </a>
        </div>
      )}
    </AuthFrame>
  );
}

export default function VerifyRequestPage() {
  return (
    <Suspense fallback={<AuthFrameFallback />}>
      <VerifyRequestContent />
    </Suspense>
  );
}
