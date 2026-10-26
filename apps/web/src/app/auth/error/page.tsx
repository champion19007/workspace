'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { AuthFrame, AuthFrameFallback } from '@/components/ui/auth-frame';

const REASON_MESSAGES: Record<string, { title: string; desc: string }> = {
  invalid_or_expired: {
    title: 'This sign-in link has expired',
    desc: 'Sign-in links can be used once and expire after a short while. Request a new one to continue.',
  },
  csrf_state_mismatch: {
    title: "We couldn't verify this sign-in",
    desc: 'For your security we stopped it. This can happen when sign-in takes too long or starts in another tab. Please start again.',
  },
  auth_callback_failed: {
    title: "Sign-in didn't finish",
    desc: "We couldn't complete sign-in with your account provider. Please try again.",
  },
  missing_credentials: {
    title: 'This sign-in link is incomplete',
    desc: 'Some of the link is missing. Open it straight from the email, or request a new one.',
  },
  different_browser: {
    title: 'Open the link in the same browser',
    desc: 'For your security, a sign-in link only works in the browser where you asked for it. Request a new link here and open it in this browser.',
  },
  oauth_init_failed: {
    title: "Google sign-in couldn't start",
    desc: 'Please try again, or use an email sign-in link instead.',
  },
};

const FALLBACK = { title: 'Something went wrong signing in', desc: 'Please try again.' };

function AuthErrorContent() {
  const reason = useSearchParams().get('reason') || 'auth_callback_failed';
  const info = REASON_MESSAGES[reason] ?? FALLBACK;

  return (
    <AuthFrame icon={AlertTriangle} tone="warning" title={info.title} description={info.desc}>
      <Link href="/auth/login" className="btn btn-primary w-full">
        Back to sign in
      </Link>
    </AuthFrame>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<AuthFrameFallback />}>
      <AuthErrorContent />
    </Suspense>
  );
}
