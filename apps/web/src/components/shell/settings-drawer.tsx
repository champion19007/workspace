'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Drawer } from '../ui/drawer';
import { useShell } from './shell-context';
import { useTheme, DEFAULT_ACCENT } from '../theme-provider';
import { RotateCcw, Palette, Cable, Keyboard, Check } from 'lucide-react';
import type { ZoomIntegrationDTO } from '@workspace/core';

export function SettingsDrawer() {
  const params = useParams();
  const orgId = (params?.orgId as string) || '';

  const { isSettingsDrawerOpen, setIsSettingsDrawerOpen } = useShell();
  const { accentColor, setAccentColor, resetAccentColor, presets } = useTheme();

  const [activeTab, setActiveTab] = useState<'appearance' | 'integrations' | 'shortcuts'>('appearance');
  const [customHex, setCustomHex] = useState(accentColor);
  const [zoomIntegration, setZoomIntegration] = useState<ZoomIntegrationDTO | null>(null);

  useEffect(() => {
    if (isSettingsDrawerOpen && activeTab === 'integrations' && orgId) {
      fetch(`/api/orgs/${orgId}/integrations/zoom`)
        .then((res) => (res.ok ? res.json() : { integration: null }))
        .then((data) => setZoomIntegration(data.integration || null))
        .catch(() => {});
    }
  }, [isSettingsDrawerOpen, activeTab, orgId]);

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

  const handleReset = () => {
    setCustomHex(DEFAULT_ACCENT);
    resetAccentColor();
  };

  return (
    <Drawer
      isOpen={isSettingsDrawerOpen}
      onClose={() => setIsSettingsDrawerOpen(false)}
      title="Settings & Preferences"
      description="Customize appearance, theme colors, and connected workspaces."
    >
      {/* Navigation Tabs (Matching Screenshots 946–948) */}
      <div className="flex border-b border-border-subtle -mt-2 mb-4">
        <button
          onClick={() => setActiveTab('appearance')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'appearance'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Appearance</span>
        </button>

        <button
          onClick={() => setActiveTab('integrations')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'integrations'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Cable className="w-3.5 h-3.5" />
          <span>Integrations</span>
        </button>

        <button
          onClick={() => setActiveTab('shortcuts')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'shortcuts'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Keyboard className="w-3.5 h-3.5" />
          <span>Shortcuts</span>
        </button>
      </div>

      {/* Tab: Appearance */}
      {activeTab === 'appearance' && (
        <div className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-foreground uppercase tracking-wider mb-2">
              Primary Accent Color
            </label>
            <p className="text-xs text-muted-foreground mb-4">
              Select an accent color or specify a custom hex code. Contrast is dynamically adjusted to ensure WCAG 2.1 AA compliance.
            </p>

            {/* Color Swatches Grid */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {presets.map((preset) => {
                const isSelected = accentColor.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button
                    key={preset.hex}
                    onClick={() => handlePresetSelect(preset.hex)}
                    className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-accent bg-panel-elevated text-foreground'
                        : 'border-border-subtle bg-panel hover:bg-panel-elevated text-muted-foreground'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: preset.hex }}
                    >
                      {isSelected && <Check className="w-2.5 h-2.5 text-slate-950 font-bold" />}
                    </span>
                    <span className="truncate">{preset.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Custom Hex Input & Swatch */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-panel-inset border border-border-subtle">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => handlePresetSelect(e.target.value)}
                aria-label="Color picker"
                className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent"
              />
              <div className="flex-1">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase">
                  Custom Hex
                </div>
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
                onClick={handleReset}
                title="Reset to default #d86dfc"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-subtle hover:bg-panel-elevated text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Live Preview Panel */}
          <div className="p-4 rounded-xl bg-panel-inset border border-border-subtle space-y-3">
            <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Live Theme Preview
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground font-semibold text-xs shadow-sm">
                Primary Button
              </button>
              <span className="px-2.5 py-1 rounded-full bg-accent/20 text-accent border border-accent/40 text-xs font-semibold">
                Accent Pill
              </span>
              <span className="w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent,#d86dfc)]" />
            </div>
          </div>
        </div>
      )}

      {/* Tab: Integrations (Matching Screenshots 946–948) */}
      {activeTab === 'integrations' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-panel-elevated border border-border-subtle space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-foreground">Zoom Video Communications</h4>
              {zoomIntegration?.status === 'connected' ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connected
                </span>
              ) : zoomIntegration?.status === 'needs_reauthorization' ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Needs Reauth
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/30">
                  Disconnected
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Account-level OAuth connection for recording metadata, verified host opt-in, and transcript streaming.
            </p>
            {zoomIntegration?.accountName && (
              <div className="text-[11px] text-muted-foreground font-mono bg-panel-inset p-2 rounded-lg border border-border-subtle">
                Account: {zoomIntegration.accountName}
              </div>
            )}
            {orgId && (
              <a
                href={`/orgs/${orgId}/settings`}
                onClick={() => setIsSettingsDrawerOpen(false)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline pt-1"
              >
                <span>Configure Host Opt-In & Permissions →</span>
              </a>
            )}
          </div>

          <div className="p-4 rounded-xl bg-panel-elevated border border-border-subtle space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-foreground">Google Workspace OIDC</h4>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Connected
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Google federated identity authentication active behind the Auth Port.
            </p>
          </div>
        </div>
      )}

      {/* Tab: Shortcuts */}
      {activeTab === 'shortcuts' && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground mb-2">
            Global and scoped keyboard navigation commands:
          </div>
          <div className="space-y-1.5 font-mono text-xs">
            <div className="flex items-center justify-between p-2 rounded-lg bg-panel-inset border border-border-subtle">
              <span className="text-muted-foreground">Command Launcher</span>
              <kbd className="px-1.5 py-0.5 rounded bg-panel-elevated border border-border-subtle text-foreground">
                Ctrl+K
              </kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-panel-inset border border-border-subtle">
              <span className="text-muted-foreground">Keyboard Shortcuts Dialog</span>
              <kbd className="px-1.5 py-0.5 rounded bg-panel-elevated border border-border-subtle text-foreground">
                Shift+?
              </kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-panel-inset border border-border-subtle">
              <span className="text-muted-foreground">Jump to Dashboard</span>
              <kbd className="px-1.5 py-0.5 rounded bg-panel-elevated border border-border-subtle text-foreground">
                Shift+D
              </kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-panel-inset border border-border-subtle">
              <span className="text-muted-foreground">Jump to Task List</span>
              <kbd className="px-1.5 py-0.5 rounded bg-panel-elevated border border-border-subtle text-foreground">
                Shift+L
              </kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-panel-inset border border-border-subtle">
              <span className="text-muted-foreground">Jump to Kanban Board</span>
              <kbd className="px-1.5 py-0.5 rounded bg-panel-elevated border border-border-subtle text-foreground">
                Shift+B
              </kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-panel-inset border border-border-subtle">
              <span className="text-muted-foreground">Jump to My Tasks</span>
              <kbd className="px-1.5 py-0.5 rounded bg-panel-elevated border border-border-subtle text-foreground">
                Alt+M
              </kbd>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
