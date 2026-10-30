'use client';

import React, { useState } from 'react';
import { Video, RotateCcw, Users, ExternalLink, Loader2 } from 'lucide-react';
import type { ZoomIntegrationDTO, ZoomScope } from '@workspace/core';
import { ZOOM_REQUIRED_SCOPES } from '@workspace/core';
import { Badge } from '../ui/badge';
import { Dialog } from '../ui/dialog';
import { Alert } from '../ui/states';
import { formatDateTime } from '@/lib/format';

const SCOPE_HINTS: Record<string, string> = {
  'recording:read:admin': 'Read cloud recordings and transcripts of opted-in hosts',
  'meeting:read:admin': 'Read meeting details and participants, to check guest consent',
  'user:read:admin': 'Read the account’s users, to match hosts to people here',
};

interface ZoomIntegrationCardProps {
  integration: ZoomIntegrationDTO | null;
  userRole?: string;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onOpenHostDrawer: () => void;
  isLoading?: boolean;
}

export function ZoomIntegrationCard({
  integration,
  userRole = 'member',
  onConnect,
  onDisconnect,
  onOpenHostDrawer,
  isLoading = false,
}: ZoomIntegrationCardProps) {
  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = userRole === 'owner' || userRole === 'admin';
  const isConnected = integration?.status === 'connected';
  const needsReauth = integration?.status === 'needs_reauthorization' || integration?.status === 'degraded';
  const isDisconnected = !integration || integration.status === 'disconnected';

  const handleConnectClick = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      await onConnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    setIsDisconnecting(true);
    setError(null);
    try {
      await onDisconnect();
      setIsConfirmingDisconnect(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <section className="card space-y-4 p-5" aria-labelledby="zoom-card-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-info-subtle text-info">
            <Video className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="zoom-card-title" className="font-semibold text-fg">
                Zoom
              </h2>
              {isConnected && <Badge variant="success">Connected</Badge>}
              {needsReauth && <Badge variant="warning">Needs reconnecting</Badge>}
              {isDisconnected && <Badge>Not connected</Badge>}
            </div>
            <p className="text-sm text-fg-muted">
              Import transcripts of Zoom cloud recordings and turn them into meeting notes. Only hosts who opt in are imported.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isConnected && (
            <button type="button" onClick={onOpenHostDrawer} className="btn btn-secondary btn-sm">
              <Users className="h-4 w-4" aria-hidden="true" />
              {canManage ? 'Manage hosts' : 'View hosts'}
            </button>
          )}
          {isDisconnected && canManage && (
            <button type="button" onClick={handleConnectClick} disabled={isLoading || isConnecting} className="btn btn-primary btn-sm">
              {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
              Connect Zoom
            </button>
          )}
          {needsReauth && canManage && (
            <button type="button" onClick={handleConnectClick} disabled={isLoading || isConnecting} className="btn btn-primary btn-sm">
              {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
              Reconnect
            </button>
          )}
          {(isConnected || needsReauth) && canManage && (
            <button type="button" onClick={() => setIsConfirmingDisconnect(true)} className="btn btn-ghost btn-sm text-danger">
              Disconnect
            </button>
          )}
        </div>
      </div>

      {isDisconnected && !canManage && (
        <p className="text-sm text-fg-muted">Ask an owner or admin of this organization to connect Zoom.</p>
      )}

      {error && !isConfirmingDisconnect && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {needsReauth && (
        <Alert tone="warning" title="Zoom needs to be reconnected">
          {integration?.lastErrorMessage ? `${integration.lastErrorMessage} ` : ''}
          Meeting imports are paused until an owner or admin reconnects.
        </Alert>
      )}

      {!isDisconnected && (
        <dl className="grid gap-3 rounded-lg bg-surface-2 p-3 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-fg-muted">Zoom account</dt>
            <dd className="truncate font-medium text-fg">
              {integration?.accountName || integration?.accountEmail || integration?.accountId}
            </dd>
            {integration?.accountEmail && integration?.accountName && (
              <dd className="truncate text-xs text-fg-muted">{integration.accountEmail}</dd>
            )}
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Connected</dt>
            <dd className="font-medium text-fg">{integration?.installedAt ? formatDateTime(integration.installedAt) : '—'}</dd>
          </div>
        </dl>
      )}

      <details className="group text-sm">
        <summary className="cursor-pointer select-none text-fg-muted hover:text-fg">What Workspace can access in Zoom</summary>
        <ul className="mt-2 space-y-1.5">
          {ZOOM_REQUIRED_SCOPES.map((scope: ZoomScope) => (
            <li key={scope} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <code className="shrink-0 font-mono text-xs text-fg sm:w-44">{scope}</code>
              <span className="text-fg-muted">{SCOPE_HINTS[scope] ?? ''}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-fg-muted">
          Read-only. Zoom sign-in tokens are kept in a separate secret store, never in the app database.
        </p>
      </details>

      <Dialog
        isOpen={isConfirmingDisconnect}
        onClose={() => !isDisconnecting && setIsConfirmingDisconnect(false)}
        title="Disconnect Zoom?"
        description="Workspace stops importing meetings and deletes its stored Zoom sign-in. You can reconnect at any time."
        maxWidthClass="max-w-md"
      >
        {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setIsConfirmingDisconnect(false)} disabled={isDisconnecting} className="btn btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={handleConfirmDisconnect} disabled={isDisconnecting} className="btn btn-danger">
            {isDisconnecting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Disconnect
          </button>
        </div>
      </Dialog>
    </section>
  );
}
