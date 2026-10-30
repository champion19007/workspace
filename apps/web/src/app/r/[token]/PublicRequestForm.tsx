'use client';

import React, { useId, useState } from 'react';
import { CircleCheck, Link2Off, Send } from 'lucide-react';
import type { PublicRequestFormDTO } from '@workspace/core';
import { AuthFrame } from '@/components/ui/auth-frame';
import { Alert } from '@/components/ui/states';

export function PublicRequestForm({ token, form }: { token: string; form: PublicRequestFormDTO | null }) {
  const ids = useId();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!form) {
    return (
      <AuthFrame
        icon={Link2Off}
        tone="warning"
        title="This form isn't available"
        description="The link may be wrong, or the team has switched the form off. Ask them for a new link."
      />
    );
  }

  if (sent) {
    return (
      <AuthFrame icon={CircleCheck} title="Thanks, your request was sent" description={`The ${form.projectName} team will see it in their Inbox.`}>
        <button
          type="button"
          onClick={() => {
            setTitle('');
            setDetails('');
            setSent(false);
          }}
          className="btn btn-secondary w-full"
        >
          Send another request
        </button>
      </AuthFrame>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/request-forms/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, details, name, email, website }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Your request couldn't be sent. Please try again.");
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthFrame title={`Send a request to ${form.projectName}`} description={`${form.orgName} will see it in their Inbox and reply by email.`}>
      <form onSubmit={submit} className="space-y-4">
        {form.intro && <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm text-fg">{form.intro}</p>}
        {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
        <div>
          <label htmlFor={`${ids}-title`} className="label">
            What do you need?
          </label>
          <input id={`${ids}-title`} required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
        </div>
        <div>
          <label htmlFor={`${ids}-details`} className="label">
            Details <span className="font-normal text-fg-muted">(optional)</span>
          </label>
          <textarea
            id={`${ids}-details`}
            rows={4}
            maxLength={5000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Links, deadlines, anything that helps"
            className="field resize-y"
          />
        </div>
        <div>
          <label htmlFor={`${ids}-name`} className="label">
            Your name
          </label>
          <input id={`${ids}-name`} required maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="field" />
        </div>
        <div>
          <label htmlFor={`${ids}-email`} className="label">
            Your email
          </label>
          <input
            id={`${ids}-email`}
            type="email"
            required
            maxLength={255}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
        </div>
        {/* Hidden from people; bots that fill it in are ignored. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor={`${ids}-website`}>Website</label>
          <input id={`${ids}-website`} tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <button type="submit" disabled={sending} className="btn btn-primary w-full">
          <Send aria-hidden="true" />
          {sending ? 'Sending…' : 'Send request'}
        </button>
      </form>
    </AuthFrame>
  );
}
