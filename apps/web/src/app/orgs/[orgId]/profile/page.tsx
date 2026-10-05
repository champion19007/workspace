'use client';

import React, { useState, useEffect } from 'react';
import { User, Mail, Globe, Bell, Check, Save } from 'lucide-react';

export default function ProfilePage() {
  const [name, setName] = useState('Alex Mercer');
  const [email, setEmail] = useState('alex@company.com');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [emailDigest, setEmailDigest] = useState(true);
  const [mentionAlerts, setMentionAlerts] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setEmail(data.session.email);
            setName(data.session.email.split('@')[0]);
          }
        }
      } catch {
        // default
      }
    }
    loadUser();
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const initial = name ? name.charAt(0).toUpperCase() : 'U';

  return (
    <div className="space-y-6 max-w-2xl animate-in fade-in duration-200">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
          Profile Settings
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage your personal account details, timezone preferences, and notification channels.
        </p>
      </div>

      <form onSubmit={handleSave} className="p-6 rounded-2xl bg-panel border border-border-subtle space-y-6">
        {/* Avatar Header Matching Screenshot 956 */}
        <div className="flex items-center gap-4 pb-6 border-b border-border-subtle">
          <div className="w-16 h-16 rounded-2xl bg-accent/20 border-2 border-accent/40 flex items-center justify-center font-black text-2xl text-accent shadow-md">
            {initial}
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">{email}</p>
            <span className="inline-block text-[10px] font-semibold text-accent mt-1">
              Active Member
            </span>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Full Name</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-panel-inset border border-border-subtle text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Email Address</span>
            </label>
            <input
              type="email"
              disabled
              value={email}
              className="w-full px-3.5 py-2.5 rounded-xl bg-panel-inset border border-border-subtle text-xs text-muted-foreground cursor-not-allowed font-mono"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Managed via passwordless auth provider.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Timezone</span>
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-panel-inset border border-border-subtle text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30) — Default</option>
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
            </select>
          </div>

          {/* Notifications */}
          <div className="pt-2 border-t border-border-subtle space-y-3">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Notifications & Digests</span>
            </h4>

            <label className="flex items-center gap-3 p-3 rounded-xl bg-panel-inset border border-border-subtle cursor-pointer hover:bg-panel-elevated transition-colors">
              <input
                type="checkbox"
                checked={emailDigest}
                onChange={(e) => setEmailDigest(e.target.checked)}
                className="rounded border-border-subtle text-accent focus:ring-accent"
              />
              <div className="text-xs">
                <div className="font-semibold text-foreground">Daily 09:00 IST Email Digest</div>
                <div className="text-[11px] text-muted-foreground">
                  Receive a summary of pending action items and daily tasks.
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl bg-panel-inset border border-border-subtle cursor-pointer hover:bg-panel-elevated transition-colors">
              <input
                type="checkbox"
                checked={mentionAlerts}
                onChange={(e) => setMentionAlerts(e.target.checked)}
                className="rounded border-border-subtle text-accent focus:ring-accent"
              />
              <div className="text-xs">
                <div className="font-semibold text-foreground">Direct @Mention Alerts</div>
                <div className="text-[11px] text-muted-foreground">
                  Notify immediately when tagged in meeting notes or task comments.
                </div>
              </div>
            </label>
          </div>
        </div>

        <div className="pt-4 border-t border-border-subtle flex items-center justify-between">
          {saved ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
              <Check className="w-4 h-4" />
              <span>Changes Saved Successfully!</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Local preferences stored</span>
          )}

          <button
            type="submit"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-accent-foreground font-bold text-xs tracking-wide shadow-md hover:opacity-90 transition-opacity"
          >
            <Save className="w-4 h-4" />
            <span>Save Changes</span>
          </button>
        </div>
      </form>
    </div>
  );
}
