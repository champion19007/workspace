'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Mail, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

function VerifyRequestContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || 'your email';

  // In mock/development mode, provide a one-click simulation
  const mockCallbackUrl = `/api/auth/callback?token=valid-mock-token&email=${encodeURIComponent(email)}`;

  return (
    <div className="min-h-screen bg-surface-2 text-fg flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-accent-subtle border border-accent/30 text-accent-text mb-6">
          <Mail className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Check your email</h1>
        <p className="mt-2 text-sm text-fg-muted max-w-sm mx-auto">
          We sent a temporary sign-in link to{' '}
          <span className="font-semibold text-fg">{email}</span>.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-surface-2 backdrop-blur-sm border border-border py-8 px-6 shadow-2xl rounded-xl sm:px-10 space-y-6">
          <div className="text-xs text-fg-muted space-y-2">
            <p>1. Open your email inbox and look for an email from Workspace.</p>
            <p>2. Click the secure sign-in link to authenticate your browser.</p>
            <p>3. The link expires in 15 minutes and can only be used once.</p>
          </div>

          <div className="p-4 rounded-xl bg-surface-2 border border-border text-xs text-fg-muted">
            <div className="font-medium text-fg mb-1">Local & Test Environment</div>
            <p className="mb-3">
              If running in mock authentication mode, you can complete the sign-in journey directly:
            </p>
            <a
              href={mockCallbackUrl}
              className="inline-flex items-center justify-center gap-2 w-full py-2 px-3 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg font-medium transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Simulate Magic Link Click</span>
            </a>
          </div>

          <div className="pt-2 text-center">
            <Link
              href="/auth/login"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-text hover:text-accent-text"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to sign in</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyRequestPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface-2 text-fg flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      }
    >
      <VerifyRequestContent />
    </Suspense>
  );
}
