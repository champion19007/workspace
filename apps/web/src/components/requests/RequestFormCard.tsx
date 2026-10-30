'use client';

import React, { useCallback, useEffect, useId, useState } from 'react';
import { Copy } from 'lucide-react';
import type { RequestFormDTO } from '@workspace/core';
import { Alert } from '@/components/ui/states';

/** Turns a project's public request form on or off and shows the link to share. */
export function RequestFormCard({ orgId, projectId }: { orgId: string; projectId: string }) {
  const ids = useId();
  // undefined while loading; null when the project never had a form.
  const [form, setForm] = useState<RequestFormDTO | null | undefined>(undefined);
  const [intro, setIntro] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/orgs/${orgId}/projects/${projectId}/request-form`;

  const load = useCallback(async () => {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.detail || "The request form couldn't be loaded.");
      return;
    }
    setForm(body.form);
    setIntro(body.form?.intro ?? '');
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, intro }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "The request form couldn't be saved.");
      setForm(body.form);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const link = form ? `${window.location.origin}/r/${form.token}` : '';
  const copy = async () => {
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (form === undefined && !error) return null;

  return (
    <section aria-labelledby={`${ids}-heading`} className="card space-y-3 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 id={`${ids}-heading`} className="text-sm font-semibold text-fg">
            Request form {form?.enabled && <span className="ml-1 text-xs font-medium text-success">On</span>}
          </h2>
          <p className="max-w-xl text-sm text-fg-muted">
            A link clients and other teams can use to ask for work, without an account. What they send arrives in your
            Inbox, where you accept it as a task or decline it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => save(!form?.enabled)}
          disabled={saving}
          className={`btn btn-sm shrink-0 self-start ${form?.enabled ? 'btn-ghost' : 'btn-secondary'}`}
        >
          {saving ? 'Saving…' : form?.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      {form?.enabled && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <label htmlFor={`${ids}-link`} className="sr-only">
              Request form link
            </label>
            <input id={`${ids}-link`} readOnly value={link} onFocus={(e) => e.target.select()} className="field font-mono text-xs" />
            <button type="button" onClick={copy} className="btn btn-secondary shrink-0">
              <Copy aria-hidden="true" />
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <div>
            <label htmlFor={`${ids}-intro`} className="label">
              Note at the top of the form <span className="font-normal text-fg-muted">(optional)</span>
            </label>
            <textarea
              id={`${ids}-intro`}
              rows={2}
              maxLength={1000}
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              onBlur={() => intro !== form.intro && save(true)}
              placeholder="For example: tell us what you need and by when. We reply within two working days."
              className="field resize-y"
            />
          </div>
        </div>
      )}
    </section>
  );
}
