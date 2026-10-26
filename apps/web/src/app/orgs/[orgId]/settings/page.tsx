'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Monitor, Moon, RotateCcw, Sun, type LucideIcon } from 'lucide-react';
import type { ZoomIntegrationDTO, ZoomHostConsentDTO, ZoomHostConsentStatus } from '@workspace/core';
import { useTheme, DEFAULT_ACCENT, type ThemePreference } from '@/components/theme-provider';
import { useShell } from '@/components/shell/shell-context';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/states';
import { ZoomIntegrationCard } from '@/components/integrations/zoom-card';
import { ZoomHostDrawer } from '@/components/integrations/zoom-host-drawer';
import { MyConsentCard } from '@/components/integrations/my-consent-card';

type Tab = 'appearance' | 'integrations';

const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'integrations', label: 'Integrations' },
];

const THEME_OPTIONS: { id: ThemePreference; label: string; icon: LucideIcon }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

// Native radios inside styled labels: arrow keys, focus and form semantics come for free.
const OPTION_CARD =
  'flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-subtle has-[:checked]:text-fg has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-text';

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.message || fallback);
}

function AppearanceSettings() {
  const { theme, setTheme, accentColor, setAccentColor, resetAccentColor, presets } = useTheme();
  const [hexDraft, setHexDraft] = useState(accentColor);
  useEffect(() => setHexDraft(accentColor), [accentColor]);

  const onHexChange = (value: string) => {
    setHexDraft(value);
    const hex = value.startsWith('#') ? value : `#${value}`;
    if (/^#[0-9a-f]{6}$/i.test(hex)) setAccentColor(hex.toLowerCase());
  };

  return (
    <div className="card divide-y divide-border">
      <fieldset className="space-y-3 p-5">
        <legend className="float-left mb-3 w-full">
          <span className="block font-semibold text-fg">Theme</span>
          <span className="block text-sm text-fg-muted">System follows your device&apos;s light or dark setting.</span>
        </legend>
        <div className="grid clear-both grid-cols-3 gap-2 sm:max-w-md">
          {THEME_OPTIONS.map(({ id, label, icon: Icon }) => (
            <label key={id} className={`${OPTION_CARD} justify-center`}>
              <input type="radio" name="theme" value={id} checked={theme === id} onChange={() => setTheme(id)} className="sr-only" />
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3 p-5">
        <legend className="float-left mb-3 w-full">
          <span className="block font-semibold text-fg">Accent colour</span>
          <span className="block text-sm text-fg-muted">
            Used for buttons, links and highlights. Text on it is adjusted to stay readable in both themes.
          </span>
        </legend>
        <div className="grid clear-both grid-cols-2 gap-2 sm:grid-cols-3 lg:max-w-xl">
          {presets.map((preset) => (
            <label key={preset.hex} className={OPTION_CARD}>
              <input
                type="radio"
                name="accent"
                value={preset.hex}
                checked={accentColor.toLowerCase() === preset.hex.toLowerCase()}
                onChange={() => setAccentColor(preset.hex)}
                className="sr-only"
              />
              <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-black/15" style={{ backgroundColor: preset.hex }} aria-hidden="true" />
              {preset.name}
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 pt-2">
          <div>
            <label htmlFor="accent-hex" className="label">
              Custom colour
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                aria-label="Pick a custom accent colour"
                className="h-9 w-10 cursor-pointer rounded-md border border-border bg-surface p-1"
              />
              <input
                id="accent-hex"
                type="text"
                value={hexDraft}
                onChange={(e) => onHexChange(e.target.value)}
                placeholder={DEFAULT_ACCENT}
                maxLength={7}
                spellCheck={false}
                className="field w-28 font-mono"
              />
            </div>
          </div>
          <button type="button" onClick={resetAccentColor} disabled={accentColor === DEFAULT_ACCENT} className="btn btn-ghost">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 p-3 text-sm">
          <span className="text-fg-muted">Preview</span>
          <span className="btn btn-primary btn-sm pointer-events-none">Primary</span>
          <span className="link">A link</span>
          <Badge variant="accent">Badge</Badge>
        </div>
      </fieldset>

      <p className="p-5 text-sm text-fg-muted">Theme and colour are saved in this browser only.</p>
    </div>
  );
}

function IntegrationSettings({ orgId, role }: { orgId: string; role: string }) {
  const [zoomIntegration, setZoomIntegration] = useState<ZoomIntegrationDTO | null>(null);
  const [zoomHosts, setZoomHosts] = useState<ZoomHostConsentDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [isHostDrawerOpen, setIsHostDrawerOpen] = useState(false);

  const fetchZoomIntegration = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/integrations/zoom`);
      if (!res.ok) throw await failure(res, "Zoom settings couldn't be loaded.");
      const data = await res.json();
      setZoomIntegration(data.integration || null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, [orgId]);

  const fetchZoomHosts = useCallback(async () => {
    setHostsLoading(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/integrations/zoom/hosts`);
      if (res.ok) setZoomHosts((await res.json()).hosts || []);
    } finally {
      setHostsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    fetchZoomIntegration();
    fetchZoomHosts();
  }, [orgId, fetchZoomIntegration, fetchZoomHosts]);

  // Card, drawer and consent card show these errors next to the control that failed.
  const handleConnectZoom = async () => {
    const res = await fetch(`/api/orgs/${orgId}/integrations/zoom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw await failure(res, "Couldn't start connecting Zoom.");
    const { authorizationUrl } = await res.json();
    if (authorizationUrl) window.location.href = authorizationUrl;
  };

  const handleDisconnectZoom = async () => {
    const res = await fetch(`/api/orgs/${orgId}/integrations/zoom`, { method: 'DELETE' });
    if (!res.ok) throw await failure(res, "Couldn't disconnect Zoom.");
    setZoomIntegration((await res.json()).integration);
    await fetchZoomHosts();
  };

  const handleUpdateHostConsent = async (
    zoomUserId: string,
    update: { consentStatus?: ZoomHostConsentStatus; adminDisabled?: boolean }
  ) => {
    const res = await fetch(`/api/orgs/${orgId}/integrations/zoom/hosts/${zoomUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    if (!res.ok) throw await failure(res, "Couldn't update this host.");
    const { host } = await res.json();
    setZoomHosts((prev) => prev.map((h) => (h.zoomUserId === zoomUserId ? host : h)));
  };

  return (
    <div className="space-y-4">
      {!loaded ? (
        <div className="card space-y-3 p-5" role="status" aria-busy="true">
          <span className="sr-only">Loading Zoom settings…</span>
          <div className="skeleton h-5 w-32" />
          <div className="skeleton h-4 w-3/4" />
        </div>
      ) : loadError ? (
        <ErrorState title="Couldn't load Zoom settings" message={loadError} onRetry={fetchZoomIntegration} />
      ) : (
        <ZoomIntegrationCard
          integration={zoomIntegration}
          userRole={role}
          onConnect={handleConnectZoom}
          onDisconnect={handleDisconnectZoom}
          onOpenHostDrawer={() => setIsHostDrawerOpen(true)}
        />
      )}

      <MyConsentCard orgId={orgId} />

      <ZoomHostDrawer
        isOpen={isHostDrawerOpen}
        onClose={() => setIsHostDrawerOpen(false)}
        hosts={zoomHosts}
        userRole={role}
        onUpdateConsent={handleUpdateHostConsent}
        isLoading={hostsLoading && zoomHosts.length === 0}
      />
    </div>
  );
}

export default function SettingsPage() {
  const params = useParams();
  const orgId = (params?.orgId as string) || '';
  const tab: Tab = useSearchParams().get('tab') === 'integrations' ? 'integrations' : 'appearance';
  const { user } = useShell();

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Settings" description="Your appearance preferences and this organization's connected services." />

      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <Link key={t.id} href={`?tab=${t.id}`} replace scroll={false} className="tab" aria-current={tab === t.id ? 'page' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'appearance' ? <AppearanceSettings /> : <IntegrationSettings orgId={orgId} role={user?.role ?? 'member'} />}
    </div>
  );
}
