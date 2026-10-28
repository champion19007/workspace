'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MailX } from 'lucide-react';
import { AuthFrame, AuthFrameFallback } from '@/components/ui/auth-frame';
import { Alert } from '@/components/ui/states';

const WHAT: Record<string, string> = {
  mentions: 'emails from this organization when someone mentions you',
  requests: 'emails from this organization about new requests',
  digest: "this organization's daily summary email",
};

// A page with a button, not an unsubscribe-on-open link: mail scanners open links in emails by themselves.
function UnsubscribeContent() {
  const token = useSearchParams().get('token') ?? '';
  const [orgId, , kind] = token.split('.');
  const what = WHAT[kind ?? ''] ?? 'these emails';
  const [state, setState] = useState<'ready' | 'working' | 'done' | 'failed'>('ready');

  const unsubscribe = async () => {
    setState('working');
    const res = await fetch(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => null);
    setState(res?.ok ? 'done' : 'failed');
  };

  return (
    <AuthFrame
      icon={MailX}
      title={state === 'done' ? "You're unsubscribed" : 'Unsubscribe'}
      description={state === 'done' ? `You won't get ${what} any more.` : `Stop getting ${what}?`}
      footer={
        <>
          Changed your mind? You can turn emails back on in your{' '}
          <Link href={orgId ? `/orgs/${encodeURIComponent(orgId)}/profile` : '/auth/login'} className="link">
            Profile
          </Link>
          .
        </>
      }
    >
      {state === 'failed' && (
        <Alert>That didn&apos;t work. The link may be old: sign in and turn the email off in your Profile instead.</Alert>
      )}
      {state !== 'done' && (
        <button type="button" onClick={unsubscribe} disabled={state === 'working'} className="btn btn-primary w-full">
          {state === 'working' ? 'Unsubscribing…' : 'Unsubscribe'}
        </button>
      )}
    </AuthFrame>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<AuthFrameFallback />}>
      <UnsubscribeContent />
    </Suspense>
  );
}
