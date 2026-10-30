'use client';

import React, { useState } from 'react';
import { Search, Loader2, Users, SearchX } from 'lucide-react';
import type { ZoomHostConsentDTO, ZoomHostConsentStatus } from '@workspace/core';
import { Drawer } from '../ui/drawer';
import { Badge } from '../ui/badge';
import { Alert, EmptyState, SkeletonRows } from '../ui/states';

interface ZoomHostDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  hosts: ZoomHostConsentDTO[];
  userRole?: string;
  onUpdateConsent: (
    zoomUserId: string,
    update: { consentStatus?: ZoomHostConsentStatus; adminDisabled?: boolean }
  ) => Promise<void>;
  isLoading?: boolean;
}

const CONSENT_BADGE: Record<ZoomHostConsentStatus, { label: string; tone: 'success' | 'neutral' | 'warning' }> = {
  opted_in: { label: 'Opted in', tone: 'success' },
  opted_out: { label: 'Opted out', tone: 'neutral' },
  unknown: { label: 'Not asked yet', tone: 'warning' },
};

export function ZoomHostDrawer({
  isOpen,
  onClose,
  hosts,
  userRole = 'member',
  onUpdateConsent,
  isLoading = false,
}: ZoomHostDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = userRole === 'owner' || userRole === 'admin';
  const q = searchQuery.trim().toLowerCase();
  const filteredHosts = hosts.filter(
    (h) => !q || h.zoomEmail.toLowerCase().includes(q) || (h.zoomName ?? '').toLowerCase().includes(q)
  );

  const update = async (zoomUserId: string, change: { consentStatus?: ZoomHostConsentStatus; adminDisabled?: boolean }) => {
    setUpdatingUserId(zoomUserId);
    setError(null);
    try {
      await onUpdateConsent(zoomUserId, change);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingUserId(null);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Zoom hosts"
      description={`${hosts.length} ${hosts.length === 1 ? 'host' : 'hosts'} found in the connected Zoom account.`}
    >
      <div className="space-y-4">
        <Alert tone="info">
          A meeting is only imported when its host has opted in. Hosts with imports turned off are skipped even if they opted in.
        </Alert>

        {error && (
          <Alert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <input
            type="search"
            placeholder="Filter by name or email"
            aria-label="Filter hosts"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="field field-sm pl-9"
          />
        </div>

        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : hosts.length === 0 ? (
          <EmptyState icon={Users} title="No hosts yet" description="Hosts appear here once Zoom reports meetings for this account." compact />
        ) : filteredHosts.length === 0 ? (
          <EmptyState icon={SearchX} title="No hosts match" description="Try another name or email." compact />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {filteredHosts.map((host) => {
              const isUpdating = updatingUserId === host.zoomUserId;
              const isOptedIn = host.consentStatus === 'opted_in';
              const badge = CONSENT_BADGE[host.consentStatus] ?? CONSENT_BADGE.unknown;
              const name = host.zoomName || host.zoomEmail;

              return (
                <li key={host.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-fg">{name}</span>
                      <Badge variant={badge.tone}>{badge.label}</Badge>
                      {host.adminDisabled && <Badge variant="danger">Imports off</Badge>}
                    </div>
                    {host.zoomName && <p className="truncate text-xs text-fg-muted">{host.zoomEmail}</p>}
                    {host.consentTimestamp && (
                      <p className="text-xs text-fg-muted">
                        Consent recorded {new Date(host.consentTimestamp).toLocaleDateString()} · policy {host.policyVersion}
                      </p>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={() => update(host.zoomUserId, { consentStatus: isOptedIn ? 'opted_out' : 'opted_in' })}
                        disabled={isUpdating}
                        className="btn btn-secondary btn-sm"
                      >
                        {isUpdating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                        {isOptedIn ? 'Mark opted out' : 'Mark opted in'}
                      </button>
                      <label className="flex items-center gap-2 text-sm text-fg-muted">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!host.adminDisabled}
                          aria-label={`Import meetings hosted by ${name}`}
                          onClick={() => update(host.zoomUserId, { adminDisabled: !host.adminDisabled })}
                          disabled={isUpdating}
                          className="group relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input transition-colors aria-checked:bg-accent disabled:opacity-50"
                        >
                          <span className="h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform group-aria-checked:translate-x-[18px]" />
                        </button>
                        <span aria-hidden="true">Import</span>
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
