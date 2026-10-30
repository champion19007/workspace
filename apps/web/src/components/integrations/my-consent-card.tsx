'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, UserCheck } from 'lucide-react';
import type { ZoomHostConsentDTO } from '@workspace/core';
import { Badge } from '../ui/badge';
import { Dialog } from '../ui/dialog';
import { Alert } from '../ui/states';

interface MyConsentCardProps {
  orgId: string;
}

export function MyConsentCard({ orgId }: MyConsentCardProps) {
  const [consent, setConsent] = useState<ZoomHostConsentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOptOut, setConfirmOptOut] = useState(false);

  const fetchMyConsent = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/zoom/my-consent`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Your Zoom preference couldn't be loaded.");
      setConsent(data.consent || null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchMyConsent();
  }, [fetchMyConsent]);

  const handleUpdateConsent = async (newStatus: 'opted_in' | 'opted_out') => {
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/zoom/my-consent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consentStatus: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Your preference couldn't be saved.");
      setConsent(data.consent);
      setConfirmOptOut(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(false);
    }
  };

  const isOptedIn = consent?.consentStatus === 'opted_in';
  const isAdminDisabled = Boolean(consent?.adminDisabled);

  return (
    <section className="card space-y-4 p-5" aria-labelledby="my-consent-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-text">
            <UserCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="my-consent-title" className="font-semibold text-fg">
                Meetings you host
              </h2>
              {!loading && !loadError && (isOptedIn ? <Badge variant="success">Importing</Badge> : <Badge>Not importing</Badge>)}
            </div>
            <p className="text-sm text-fg-muted">
              {isOptedIn
                ? 'Transcripts of Zoom meetings you host are imported, credited to you and filed under a project.'
                : 'Zoom meetings you host are not imported. Opt in to get notes and suggested tasks from them.'}
            </p>
            {isOptedIn && consent?.consentTimestamp && (
              <p className="text-xs text-fg-muted">You opted in on {new Date(consent.consentTimestamp).toLocaleDateString()}.</p>
            )}
          </div>
        </div>

        {!loading && !loadError && (
          <div className="shrink-0">
            {isOptedIn ? (
              <button type="button" onClick={() => setConfirmOptOut(true)} disabled={updating || isAdminDisabled} className="btn btn-secondary btn-sm">
                Opt out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleUpdateConsent('opted_in')}
                disabled={updating || isAdminDisabled}
                className="btn btn-primary btn-sm"
              >
                {updating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Opt in
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="skeleton h-4 w-56" aria-hidden="true" />
      ) : loadError ? (
        <Alert
          tone="danger"
          title="Couldn't load your preference"
          action={
            <button type="button" onClick={fetchMyConsent} className="btn btn-secondary btn-sm">
              Try again
            </button>
          }
        >
          {loadError}
        </Alert>
      ) : null}

      {isAdminDisabled && (
        <Alert tone="warning">An owner or admin has turned off imports for meetings you host, so this can&apos;t be changed here.</Alert>
      )}
      {error && !confirmOptOut && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Dialog
        isOpen={confirmOptOut}
        onClose={() => !updating && setConfirmOptOut(false)}
        title="Stop importing your meetings?"
        description="Meetings you host won't be imported from now on, and imports still in progress for your meetings are skipped."
        maxWidthClass="max-w-md"
      >
        {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmOptOut(false)} disabled={updating} className="btn btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={() => handleUpdateConsent('opted_out')} disabled={updating} className="btn btn-danger">
            {updating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Opt out
          </button>
        </div>
      </Dialog>
    </section>
  );
}
