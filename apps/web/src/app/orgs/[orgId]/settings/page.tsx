'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Palette,
  Settings as SettingsIcon,
  ShieldCheck,
  Cable,
  RotateCcw,
  Check,
} from 'lucide-react';
import { useTheme, DEFAULT_ACCENT, AccentPreset } from '@/components/theme-provider';
import { ZoomIntegrationCard } from '@/components/integrations/zoom-card';
import { ZoomHostDrawer } from '@/components/integrations/zoom-host-drawer';
import { MyConsentCard } from '@/components/integrations/my-consent-card';
import type {
  ZoomIntegrationDTO,
  ZoomHostConsentDTO,
  ZoomHostConsentStatus,
} from '@workspace/core';

export default function SettingsPage() {
  const params = useParams();
  const orgId = (params?.orgId as string) || '';

  const { accentColor, setAccentColor, resetAccentColor, presets } = useTheme();

  const [activeTab, setActiveTab] = useState<'appearance' | 'general' | 'integrations' | 'security'>('appearance');
  const [customHex, setCustomHex] = useState(accentColor);
  const [retentionDays, setRetentionDays] = useState(180);

  // Zoom Integration State
  const [zoomIntegration, setZoomIntegration] = useState<ZoomIntegrationDTO | null>(null);
  const [zoomHosts, setZoomHosts] = useState<ZoomHostConsentDTO[]>([]);
  const [isHostDrawerOpen, setIsHostDrawerOpen] = useState(false);
  const [isLoadingZoom, setIsLoadingZoom] = useState(false);

  const fetchZoomIntegration = useCallback(async () => {
    if (!orgId) return;
    setIsLoadingZoom(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/integrations/zoom`);
      if (res.ok) {
        const data = await res.json();
        setZoomIntegration(data.integration || null);
      }
    } catch (err) {
      console.error('Failed to load Zoom integration:', err);
    } finally {
      setIsLoadingZoom(false);
    }
  }, [orgId]);

  const fetchZoomHosts = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/integrations/zoom/hosts`);
      if (res.ok) {
        const data = await res.json();
        setZoomHosts(data.hosts || []);
      }
    } catch (err) {
      console.error('Failed to load Zoom hosts:', err);
    }
  }, [orgId]);

  useEffect(() => {
    if (activeTab === 'integrations') {
      fetchZoomIntegration();
      fetchZoomHosts();
    }
  }, [activeTab, fetchZoomIntegration, fetchZoomHosts]);

  const handleConnectZoom = async () => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/integrations/zoom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to initiate Zoom authorization');
      }

      const { authorizationUrl } = await res.json();
      if (authorizationUrl) {
        window.location.href = authorizationUrl;
      }
    } catch (err) {
      console.error('Error initiating Zoom connection:', err);
      alert(err instanceof Error ? err.message : 'Failed to connect Zoom');
    }
  };

  const handleDisconnectZoom = async () => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/integrations/zoom`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to disconnect Zoom');
      }

      const data = await res.json();
      setZoomIntegration(data.integration);
      await fetchZoomHosts();
    } catch (err) {
      console.error('Error disconnecting Zoom:', err);
      alert(err instanceof Error ? err.message : 'Failed to disconnect Zoom');
    }
  };

  const handleUpdateHostConsent = async (
    zoomUserId: string,
    update: { consentStatus?: ZoomHostConsentStatus; adminDisabled?: boolean }
  ) => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/integrations/zoom/hosts/${zoomUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to update host consent');
      }

      const data = await res.json();
      setZoomHosts((prev) =>
        prev.map((h) => (h.zoomUserId === zoomUserId ? data.host : h))
      );
    } catch (err) {
      console.error('Error updating host consent:', err);
      alert(err instanceof Error ? err.message : 'Failed to update host consent');
    }
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomHex(val);
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      setAccentColor(val);
    }
  };

  const handlePresetSelect = (hex: string) => {
    setCustomHex(hex);
    setAccentColor(hex);
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-200">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
          Organization Settings
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure interface themes, external integrations, retention rules, and tenant preferences.
        </p>
      </div>

      {/* Tabs Header Matching Screenshot 958 & Screenshot 944 */}
      <div className="flex border-b border-border-subtle gap-2">
        <button
          onClick={() => setActiveTab('appearance')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'appearance'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Palette className="w-4 h-4" />
          <span>Appearance</span>
        </button>

        <button
          onClick={() => setActiveTab('integrations')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'integrations'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Cable className="w-4 h-4" />
          <span>Integrations</span>
        </button>

        <button
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'general'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <SettingsIcon className="w-4 h-4" />
          <span>General</span>
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'security'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Security & RLS</span>
        </button>
      </div>

      {/* Tab: Appearance Matching Screenshot 958 */}
      {activeTab === 'appearance' && (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-panel border border-border-subtle space-y-5">
            <div>
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider mb-1">
                Primary Brand & Accent Color
              </h2>
              <p className="text-xs text-muted-foreground">
                Customize the interface accent color. Workspace v1 dynamically calculates
                foreground luminance to preserve WCAG 2.1 AA readability.
              </p>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {presets.map((preset: AccentPreset) => {
                const isSelected = accentColor.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button
                    key={preset.hex}
                    onClick={() => handlePresetSelect(preset.hex)}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs font-semibold transition-all ${
                      isSelected
                        ? 'border-accent bg-panel-elevated shadow-sm'
                        : 'border-border-subtle bg-panel hover:bg-panel-elevated'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-black/20 shrink-0"
                      style={{ backgroundColor: preset.hex }}
                    />
                    <span className="text-foreground">{preset.name}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-accent ml-auto" />}
                  </button>
                );
              })}
            </div>

            {/* Custom Hex Row */}
            <div className="pt-2 border-t border-border-subtle flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle">
                <span className="text-xs text-muted-foreground font-mono">Hex:</span>
                <input
                  type="text"
                  value={customHex}
                  onChange={handleHexChange}
                  placeholder="#d86dfc"
                  maxLength={7}
                  className="w-full bg-transparent text-xs font-mono font-bold text-foreground focus:outline-none"
                />
              </div>

              <button
                onClick={() => {
                  setCustomHex(DEFAULT_ACCENT);
                  resetAccentColor();
                }}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-border-subtle bg-panel hover:bg-panel-elevated text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Default</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Integrations Matching Screenshot 944 */}
      {activeTab === 'integrations' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider mb-1">
              Connected Services & Meeting Integrations
            </h2>
            <p className="text-xs text-muted-foreground">
              Administer cloud meeting intake, OAuth authorization, verified host opt-in, and transcript streaming.
            </p>
          </div>

          <ZoomIntegrationCard
            integration={zoomIntegration}
            orgId={orgId}
            userRole="owner"
            onConnect={handleConnectZoom}
            onDisconnect={handleDisconnectZoom}
            onOpenHostDrawer={() => setIsHostDrawerOpen(true)}
            isLoading={isLoadingZoom}
          />

          <MyConsentCard orgId={orgId} />

          <ZoomHostDrawer
            isOpen={isHostDrawerOpen}
            onClose={() => setIsHostDrawerOpen(false)}
            hosts={zoomHosts}
            userRole="owner"
            onUpdateConsent={handleUpdateHostConsent}
            isLoading={isLoadingZoom}
          />
        </div>
      )}

      {/* Tab: General */}
      {activeTab === 'general' && (
        <div className="p-6 rounded-2xl bg-panel border border-border-subtle space-y-4">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider mb-2">
            Data Retention & Lifecycle
          </h2>

          <div className="space-y-3 max-w-md">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Transcript & Notes Retention (Days)
              </label>
              <input
                type="number"
                min={30}
                max={365}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-panel-inset border border-border-subtle text-xs text-foreground focus:outline-none"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Permitted range: 30 to 365 days. Default: 180 days.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Security */}
      {activeTab === 'security' && (
        <div className="p-6 rounded-2xl bg-panel border border-border-subtle space-y-4">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider mb-2">
            Security Invariants
          </h2>
          <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            <div className="p-3 rounded-xl bg-panel-inset border border-border-subtle flex items-center justify-between">
              <span>PostgreSQL Row-Level Security</span>
              <span className="text-emerald-400 font-mono font-bold">ENFORCED</span>
            </div>
            <div className="p-3 rounded-xl bg-panel-inset border border-border-subtle flex items-center justify-between">
              <span>Managed Secret Store (Zero Plaintext Token DB)</span>
              <span className="text-emerald-400 font-mono font-bold">ACTIVE</span>
            </div>
            <div className="p-3 rounded-xl bg-panel-inset border border-border-subtle flex items-center justify-between">
              <span>BFF 30-Day Rolling Sessions</span>
              <span className="text-emerald-400 font-mono font-bold">ACTIVE</span>
            </div>
            <div className="p-3 rounded-xl bg-panel-inset border border-border-subtle flex items-center justify-between">
              <span>Tenant Compound Foreign Keys</span>
              <span className="text-emerald-400 font-mono font-bold">RESTRICTIVE</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
