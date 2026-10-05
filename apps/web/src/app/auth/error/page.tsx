'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const REASON_MESSAGES: Record<string, { title: string; desc: string }> = {
  invalid_or_expired: {
    title: 'Sign-in Link Expired or Invalid',
    desc: 'This link has either already been used or expired after 15 minutes. Please request a new magic link.',
  },
  csrf_state_mismatch: {
    title: 'Security Verification Failed',
    desc: 'An OAuth state mismatch occurred. This could be due to a slow redirect or an attempted cross-site request. Please restart login.',
  },
  auth_callback_failed: {
    title: 'Authentication Error',
    desc: 'We were unable to complete authentication with the identity provider. Please try again.',
  },
  missing_credentials: {
    title: 'Missing Credentials',
    desc: 'No valid login token or authorization code was received.',
  },
};

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason') || 'auth_callback_failed';
  const info = REASON_MESSAGES[reason] || {
    title: 'Authentication Error',
    desc: 'An unexpected issue occurred during login. Please try again.',
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-min-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400 mb-6">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{info.title}</h1>
        <p className="mt-2 text-sm text-slate-400 max-w-sm mx-auto">{info.desc}</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 text-center">
          <Link
            href="/auth/login"
            className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Sign In</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  );
}
