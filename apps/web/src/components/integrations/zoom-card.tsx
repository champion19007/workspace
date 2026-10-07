'use client';

import React, { useState } from 'react';
import {
  Video,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Users,
  ShieldCheck,
  ExternalLink,
  Loader2,
  Trash2,
} from 'lucide-react';
import type { ZoomIntegrationDTO, ZoomScope } from '@workspace/core';
import { ZOOM_REQUIRED_SCOPES } from '@workspace/core';

interface ZoomIntegrationCardProps {
  integration: ZoomIntegrationDTO | null;
  orgId: string;
  userRole?: string;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onOpenHostDrawer: () => void;
  isLoading?: boolean;
}

export function ZoomIntegrationCard({
  integration,
  orgId: _orgId,
  userRole = 'member',
  onConnect,
  onDisconnect,
  onOpenHostDrawer,
  isLoading = false,
}: ZoomIntegrationCardProps) {
  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const canManage = userRole === 'owner' || userRole === 'admin';
  const isConnected = integration?.status === 'connected';
  const needsReauth = integration?.status === 'needs_reauthorization' || integration?.status === 'degraded';
  const isDisconnected = !integration || integration.status === 'disconnected';

  const handleConnectClick = async () => {
    setIsConnecting(true);
    try {
      await onConnect();
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await onDisconnect();
      setIsConfirmingDisconnect(false);
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="bg-panel border border-border-subtle rounded-2xl p-5 lg:p-6 space-y-5 transition-all">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#2D8CFF]/10 border border-[#2D8CFF]/20 flex items-center justify-center text-[#2D8CFF] shrink-0">
            <Video className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm lg:text-base font-bold text-foreground">
                Zoom Video Communications
              </h3>
              {/* Status Badge Matching Screenshot 944 */}
              {isConnected && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connected
                </span>
              )}
              {needsReauth && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Needs Reauthorization
                </span>
              )}
              {isDisconnected && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  Disconnected
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Capture meeting recordings, resolve verified host consent, and stream cloud transcripts.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          {isDisconnected && canManage && (
            <button
              onClick={handleConnectClick}
              disabled={isLoading || isConnecting}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-accent-foreground text-xs font-semibold shadow hover:opacity-95 transition-opacity disabled:opacity-50"
            >
              {isConnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )}
              <span>Connect Zoom</span>
            </button>
          )}

          {needsReauth && canManage && (
            <button
              onClick={handleConnectClick}
              disabled={isLoading || isConnecting}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold shadow hover:bg-amber-400 transition-colors disabled:opacity-50"
            >
              {isConnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              <span>Reconnect</span>
            </button>
          )}

          {isConnected && (
            <>
              <button
                onClick={onOpenHostDrawer}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border-subtle bg-panel-elevated hover:bg-border-subtle text-xs font-semibold text-foreground transition-colors"
              >
                <Users className="w-3.5 h-3.5 text-accent" />
                <span>Manage Hosts</span>
              </button>

              {canManage && (
                <button
                  onClick={() => setIsConfirmingDisconnect(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 text-xs font-semibold transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Disconnect</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Degradation Warning Banner */}
      {needsReauth && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3 text-xs text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-200">
              Authorization Degraded: {integration?.lastErrorMessage || 'Refresh token has been revoked or expired.'}
            </p>
            <p className="text-[11px] text-amber-300/80 leading-relaxed">
              Transcript streaming and meeting processing are temporarily paused until an organization Administrator reconnects Zoom.
            </p>
          </div>
        </div>
      )}

      {/* Integration Details Strip (When Connected or Needs Reauth) */}
      {!isDisconnected && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-panel-inset border border-border-subtle text-xs">
          <div>
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Connected Account
            </span>
            <span className="font-semibold text-foreground truncate block mt-0.5">
              {integration?.accountName || integration?.accountEmail || integration?.accountId}
            </span>
            {integration?.accountEmail && integration?.accountName && (
              <span className="text-[11px] text-muted-foreground block truncate">
                {integration.accountEmail}
              </span>
            )}
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Installed Date
            </span>
            <span className="font-semibold text-foreground block mt-0.5">
              {integration?.installedAt
                ? new Date(integration.installedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })
                : '—'}
            </span>
            <span className="text-[11px] text-muted-foreground block">
              Generation #{integration?.connectionGeneration ?? 1}
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
              Credential Storage
            </span>
            <span className="font-semibold text-emerald-400 flex items-center gap-1 mt-0.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Managed Secret Store
            </span>
            <span className="text-[11px] text-muted-foreground block">
              Zero plaintext DB storage
            </span>
          </div>
        </div>
      )}

      {/* Granted Scopes Badge List */}
      <div>
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
          Authorized Product Scopes (Transcript-Only)
        </span>
        <div className="flex flex-wrap gap-2">
          {ZOOM_REQUIRED_SCOPES.map((scope: ZoomScope) => (
            <span
              key={scope}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-panel-elevated border border-border-subtle text-[11px] font-mono text-foreground"
            >
              <CheckCircle2 className="w-3 h-3 text-accent" />
              {scope}
            </span>
          ))}
        </div>
      </div>

      {/* Disconnect Confirmation Modal */}
      {isConfirmingDisconnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-panel border border-border-strong rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-foreground">
                Disconnect Zoom Integration?
              </h3>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Disconnecting will immediately revoke access tokens with Zoom, purge stored credentials from our managed secret store, and halt all meeting transcription intake.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setIsConfirmingDisconnect(false)}
                disabled={isDisconnecting}
                className="px-3.5 py-2 rounded-xl border border-border-subtle bg-panel-elevated hover:bg-border-subtle text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDisconnect}
                disabled={isDisconnecting}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow transition-colors disabled:opacity-50"
              >
                {isDisconnecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                <span>Yes, Disconnect</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
