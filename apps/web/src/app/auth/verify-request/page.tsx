'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail } from 'lucide-react';
import { AuthFrame, AuthFrameFallback } from '@/components/ui/auth-frame';

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
        Open the email from Workspace and select the link. You can close this tab. If it isn&apos;t in your inbox, check your spam
        folder.
      </p>

      {process.env.NODE_ENV !== 'production' && (
        <div className="rounded-lg border border-dashed border-border-strong p-3 text-sm">
          <p className="mb-2 text-fg-muted">Local development uses mock sign-in, so no email is sent.</p>
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
