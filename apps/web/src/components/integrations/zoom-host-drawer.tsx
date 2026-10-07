'use client';

import React, { useState } from 'react';
import { Drawer } from '../ui/drawer';
import {
  Users,
  ShieldCheck,
  Search,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Lock,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Info,
} from 'lucide-react';
import type { ZoomHostConsentDTO, ZoomHostConsentStatus } from '@workspace/core';

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

export function ZoomHostDrawer({
  isOpen,
  onClose,
  hosts,
  userRole = 'member',
  onUpdateConsent,
  isLoading = false,
}: ZoomHostDrawerProps) {
  const [activeTab, setActiveTab] = useState<'hosts' | 'permissions' | 'security'>('hosts');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const canManage = userRole === 'owner' || userRole === 'admin';

  const filteredHosts = hosts.filter((h) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      h.zoomEmail.toLowerCase().includes(q) ||
      (h.zoomName && h.zoomName.toLowerCase().includes(q))
    );
  });

  const handleToggleConsent = async (
    zoomUserId: string,
    currentStatus: ZoomHostConsentStatus
  ) => {
    setUpdatingUserId(zoomUserId);
    try {
      const nextStatus: ZoomHostConsentStatus =
        currentStatus === 'opted_in' ? 'opted_out' : 'opted_in';
      await onUpdateConsent(zoomUserId, { consentStatus: nextStatus });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleToggleAdminDisabled = async (
    zoomUserId: string,
    currentDisabled: boolean
  ) => {
    if (!canManage) return;
    setUpdatingUserId(zoomUserId);
    try {
      await onUpdateConsent(zoomUserId, { adminDisabled: !currentDisabled });
    } finally {
      setUpdatingUserId(null);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Zoom Integration Settings"
      description="Host opt-in consent controls, security permissions, and ingestion boundaries."
    >
      {/* Tab Navigation Matching Screenshots 946–948 */}
      <div className="flex border-b border-border-subtle -mt-2 mb-4">
        <button
          onClick={() => setActiveTab('hosts')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'hosts'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Host Opt-In ({hosts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('permissions')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'permissions'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Scopes & APIs</span>
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'security'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Security & Secrets</span>
        </button>
      </div>

      {/* Tab 1: Host Opt-In */}
      {activeTab === 'hosts' && (
        <div className="space-y-4">
          {/* Policy Notice Callout */}
          <div className="p-3.5 rounded-xl bg-accent/10 border border-accent/20 flex items-start gap-2.5 text-xs text-foreground">
            <Info className="w-4 h-4 shrink-0 text-accent mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-accent">Host-Level Consent Guarantee</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Workspace v1 never ingests, records, or transcribes meetings without explicit host opt-in. Unregistered hosts or hosts disabled by administrators are strictly excluded before downloading any media.
              </p>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter hosts by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-panel-inset border border-border-subtle rounded-xl pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-border-strong"
            />
          </div>

          {/* Hosts List */}
          <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center p-8 text-xs text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
                <span>Loading discovered hosts...</span>
              </div>
            ) : filteredHosts.length === 0 ? (
              <div className="text-center p-8 bg-panel-inset border border-border-subtle rounded-xl text-xs text-muted-foreground">
                No Zoom hosts matching filter.
              </div>
            ) : (
              filteredHosts.map((host) => {
                const isUpdating = updatingUserId === host.zoomUserId;
                const isOptedIn = host.consentStatus === 'opted_in';
                const isOptedOut = host.consentStatus === 'opted_out';
                const isUnknown = host.consentStatus === 'unknown';

                return (
                  <div
                    key={host.id}
                    className="p-3.5 rounded-xl bg-panel-inset border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground truncate">
                          {host.zoomName || host.zoomEmail}
                        </span>
                        {isOptedIn && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            Opted In
                          </span>
                        )}
                        {isOptedOut && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <XCircle className="w-2.5 h-2.5" />
                            Opted Out
                          </span>
                        )}
                        {isUnknown && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
                            <HelpCircle className="w-2.5 h-2.5" />
                            Pending Consent
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-muted-foreground truncate font-mono">
                        {host.zoomEmail}
                      </div>

                      {host.consentTimestamp && (
                        <div className="text-[10px] text-muted-foreground">
                          Policy {host.policyVersion} • Consented{' '}
                          {new Date(host.consentTimestamp).toLocaleDateString()}
                        </div>
                      )}
                    </div>

                    {/* Controls Row */}
                    <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                      {/* Host Opt-In Action */}
                      <button
                        onClick={() => handleToggleConsent(host.zoomUserId, host.consentStatus)}
                        disabled={isUpdating}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                          isOptedIn
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                        }`}
                      >
                        {isUpdating ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : isOptedIn ? (
                          'Revoke Consent'
                        ) : (
                          'Grant Opt-In'
                        )}
                      </button>

                      {/* Admin Processing Switch */}
                      {canManage && (
                        <button
                          onClick={() =>
                            handleToggleAdminDisabled(host.zoomUserId, host.adminDisabled)
                          }
                          disabled={isUpdating}
                          title={
                            host.adminDisabled
                              ? 'Admin processing disabled for this host'
                              : 'Admin processing enabled'
                          }
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {host.adminDisabled ? (
                            <ToggleLeft className="w-5 h-5 text-rose-400" />
                          ) : (
                            <ToggleRight className="w-5 h-5 text-emerald-400" />
                          )}
                          <span className="text-[10px] uppercase font-bold">
                            {host.adminDisabled ? 'Disabled' : 'Enabled'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Permissions & Scopes */}
      {activeTab === 'permissions' && (
        <div className="space-y-4 text-xs">
          <div className="p-3.5 rounded-xl bg-panel-inset border border-border-subtle space-y-3">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
              Official Granular OAuth Scopes
            </h4>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Workspace v1 requests only the minimum granular scopes required to receive transcript metadata and evaluate participant consent:
            </p>

            <div className="space-y-2.5 pt-1">
              <div className="p-2.5 rounded-lg bg-panel border border-border-subtle space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-accent">
                    recording:read:admin
                  </span>
                  <span className="text-[10px] text-muted-foreground">Account Level</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Accesses cloud recording and transcript metadata for opted-in hosts.
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-panel border border-border-subtle space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-accent">
                    meeting:read:admin
                  </span>
                  <span className="text-[10px] text-muted-foreground">Account Level</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Resolves scheduled meeting details and past participant rosters to evaluate guest consent.
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-panel border border-border-subtle space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-accent">
                    user:read:admin
                  </span>
                  <span className="text-[10px] text-muted-foreground">Account Level</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Discovers account user profiles to map host identities and manage consent.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Security & Secrets Architecture */}
      {activeTab === 'security' && (
        <div className="space-y-4 text-xs">
          <div className="p-3.5 rounded-xl bg-panel-inset border border-border-subtle space-y-2.5">
            <div className="flex items-center gap-2 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <h4 className="text-xs font-bold uppercase tracking-wider">
                Managed Secret Store Architecture
              </h4>
            </div>

            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Workspace v1 enforces a strict isolation boundary between the application database and OAuth tokens:
            </p>

            <ul className="list-disc list-inside space-y-1.5 text-[11px] text-muted-foreground">
              <li>
                <strong className="text-foreground">Zero Plaintext Storage:</strong> Refresh and access tokens are never saved in database columns. The application database only holds an opaque <code className="text-accent font-mono">secret_arn</code> pointer.
              </li>
              <li>
                <strong className="text-foreground">Automated Token Refresh:</strong> Credentials are automatically rotated before the final 5 minutes of validity using distributed transactional locks.
              </li>
              <li>
                <strong className="text-foreground">Fencing Token Protection:</strong> A monotonically increasing <code className="text-accent font-mono">connection_generation</code> counter protects against stale asynchronous workers overwriting rotated credentials.
              </li>
              <li>
                <strong className="text-foreground">Immediate Purge on Disconnect:</strong> Disconnecting immediately revokes the tokens with Zoom and purges credentials from the secret store.
              </li>
            </ul>
          </div>
        </div>
      )}
    </Drawer>
  );
}
