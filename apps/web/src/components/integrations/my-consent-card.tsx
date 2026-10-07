'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
} from 'lucide-react';
import type { ZoomHostConsentDTO } from '@workspace/core';

interface MyConsentCardProps {
  orgId: string;
}

export function MyConsentCard({ orgId }: MyConsentCardProps) {
  const [consent, setConsent] = useState<ZoomHostConsentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOptOut, setConfirmOptOut] = useState(false);

  const fetchMyConsent = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/zoom/my-consent`);
      const data = await res.json();
      if (res.ok) {
        setConsent(data.consent || null);
      } else {
        throw new Error(data.message || 'Failed to fetch personal consent settings');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update consent preferences');
      }
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
    <div className="bg-panel border border-border-subtle rounded-2xl p-5 lg:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">
              My Host Recording &amp; Transcription Consent
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Control whether meetings you host are processed into Workspace transcripts and action items.
            </p>
          </div>
        </div>

        <div>
          {loading ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <RotateCw className="w-3.5 h-3.5 animate-spin" /> Loading...
            </span>
          ) : isOptedIn ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Processing Active (Opted In)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
              <ShieldAlert className="w-3.5 h-3.5" />
              Processing Inactive (Opted Out)
            </span>
          )}
        </div>
      </div>

      {isAdminDisabled && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>
            Meeting transcription has been administratively disabled for your account by an organization Owner.
          </span>
        </div>
      )}

      {error && (
        <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          {error}
        </div>
      )}

      <div className="p-3.5 rounded-xl bg-panel-inset border border-border-subtle text-xs space-y-2">
        <div className="text-muted-foreground leading-relaxed">
          {isOptedIn ? (
            <span>
              You have consented to automated intake. Transcripts for meetings where you are the host will be ingested,
              attributed to you, and queued for project routing.
              {consent?.consentTimestamp && (
                <span className="block mt-1 font-mono text-[11px] text-muted-foreground/80">
                  Consent recorded: {new Date(consent.consentTimestamp).toLocaleString()}
                </span>
              )}
            </span>
          ) : (
            <span>
              Your meetings are currently excluded from transcript ingestion and downstream AI extraction.
              Recordings you host will not be ingested by Workspace v1.
            </span>
          )}
        </div>

        {/* Action Toggle */}
        <div className="pt-2 border-t border-border-subtle flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground">
            Self-Service Preference:
          </span>

          {isOptedIn ? (
            confirmOptOut ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-rose-400">Fence in-flight meetings?</span>
                <button
                  type="button"
                  onClick={() => handleUpdateConsent('opted_out')}
                  disabled={updating || isAdminDisabled}
                  className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px] disabled:opacity-50"
                >
                  {updating ? 'Fencing...' : 'Yes, Opt Out'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOptOut(false)}
                  className="px-2 py-1 rounded-md border border-border-subtle text-muted-foreground text-[11px]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmOptOut(true)}
                disabled={updating || isAdminDisabled}
                className="px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 font-semibold text-xs transition-colors disabled:opacity-50"
              >
                Opt Out of Transcription
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => handleUpdateConsent('opted_in')}
              disabled={updating || isAdminDisabled}
              className="px-3.5 py-1.5 rounded-lg bg-accent text-accent-foreground font-semibold text-xs hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {updating ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Opt In to Meeting Transcription
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
