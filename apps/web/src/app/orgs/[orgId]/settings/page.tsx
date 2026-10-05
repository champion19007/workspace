'use client';

import React, { useState } from 'react';
import {
  Palette,
  Settings as SettingsIcon,
  ShieldCheck,
  RotateCcw,
  Check,
} from 'lucide-react';
import { useTheme, DEFAULT_ACCENT, AccentPreset } from '@/components/theme-provider';
import { CompletionRing } from '@/components/ui/completion-ring';

export default function SettingsPage() {
  const { accentColor, setAccentColor, resetAccentColor, presets } = useTheme();

  const [activeTab, setActiveTab] = useState<'appearance' | 'general' | 'security'>('appearance');
  const [customHex, setCustomHex] = useState(accentColor);
  const [retentionDays, setRetentionDays] = useState(180);

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
          Configure interface themes, retention rules, and tenant preferences.
        </p>
      </div>

      {/* Tabs Header Matching Screenshot 958 */}
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
                        ? 'border-accent bg-panel-elevated text-foreground shadow-sm'
                        : 'border-border-subtle bg-panel-inset hover:bg-panel-elevated text-muted-foreground'
                    }`}
                  >
                    <span
                      className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center shadow-inner"
                      style={{ backgroundColor: preset.hex }}
                    >
                      {isSelected && <Check className="w-3 h-3 text-slate-950 font-bold" />}
                    </span>
                    <span className="truncate">{preset.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Hex Picker & Reset */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-panel-inset border border-border-subtle">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => handlePresetSelect(e.target.value)}
                  className="w-9 h-9 rounded-xl cursor-pointer border-0 bg-transparent"
                />
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Hex Code
                  </div>
                  <input
                    type="text"
                    value={customHex}
                    onChange={handleHexChange}
                    maxLength={7}
                    className="bg-transparent font-mono font-bold text-sm text-foreground focus:outline-none"
                  />
                </div>
              </div>

              <button
                onClick={() => {
                  setCustomHex(DEFAULT_ACCENT);
                  resetAccentColor();
                }}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-border-subtle hover:bg-panel-elevated text-xs font-medium text-muted-foreground hover:text-foreground transition-colors self-start sm:self-auto"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Default Orchid (#d86dfc)</span>
              </button>
            </div>
          </div>

          {/* Live Preview Panel Matching Screenshot 958 */}
          <div className="p-6 rounded-2xl bg-panel border border-border-subtle space-y-4">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Component Appearance Preview
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-panel-inset border border-border-subtle space-y-3">
                <div className="text-xs font-semibold text-foreground">Interactive Buttons</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="px-4 py-2 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-md">
                    Solid Action Button
                  </button>
                  <span className="px-2.5 py-1 rounded-full bg-accent/20 text-accent border border-accent/40 text-xs font-semibold">
                    Accent Pill
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-panel-inset border border-border-subtle flex items-center justify-center">
                <CompletionRing percentage={75} size={110} label="SAMPLE RING" />
              </div>
            </div>
          </div>
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
