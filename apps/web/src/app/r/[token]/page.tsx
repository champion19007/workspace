import type { Metadata } from 'next';
import { getServerContext } from '@/lib/server-context';
import { getPublicRequestForm } from '@workspace/db';
import { REQUEST_FORM_TOKEN_PATTERN } from '@workspace/core';
import { PublicRequestForm } from './PublicRequestForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Send a request · Workspace', robots: { index: false, follow: false } };

/** A project's public request form: anyone with the link can ask the team for something. */
export default async function PublicRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = REQUEST_FORM_TOKEN_PATTERN.test(token)
    ? await getPublicRequestForm(getServerContext().sql, token).catch(() => null)
    : null;
  return <PublicRequestForm token={token} form={form} />;
}
