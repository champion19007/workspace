'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ArrowRight, AlertCircle } from 'lucide-react';

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-slugify name unless user manually edited slug
  useEffect(() => {
    if (!slugTouched) {
      const generated = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setSlug(generated);
    }
  }, [name, slugTouched]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create organization');
      }

      router.push(`/orgs/${data.org.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-foreground flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/20 border border-accent/40 text-accent mb-4 shadow-md">
          <Building2 className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Create your workspace</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Set up an isolated organisation for your team, tasks, and meeting notes.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-panel border border-border-subtle py-8 px-6 shadow-2xl rounded-2xl sm:px-10">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="orgName" className="block text-[11px] font-bold text-foreground uppercase tracking-wider mb-1.5">
                Organisation Name
              </label>
              <input
                id="orgName"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Technologies"
                className="w-full rounded-xl bg-panel-inset border border-border-subtle px-3.5 py-2.5 text-foreground placeholder:text-muted-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
              />
            </div>

            <div>
              <label htmlFor="orgSlug" className="block text-[11px] font-bold text-foreground uppercase tracking-wider mb-1.5">
                URL Identifier (Slug)
              </label>
              <div className="flex items-center rounded-xl bg-panel-inset border border-border-subtle px-3.5 py-2.5 focus-within:ring-1 focus-within:ring-accent transition-colors">
                <span className="text-xs text-muted-foreground select-none mr-1.5">app.workspace.dev/</span>
                <input
                  id="orgSlug"
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                  }}
                  placeholder="acme-technologies"
                  className="w-full bg-transparent text-foreground placeholder:text-muted-foreground text-xs focus:outline-none"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Lowercase alphanumeric and hyphens. You will be assigned the <strong>Owner</strong> role.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !name || !slug}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-accent hover:opacity-90 disabled:opacity-50 text-xs font-bold text-accent-foreground shadow-md transition-opacity"
            >
              {loading ? (
                <span>Provisioning workspace...</span>
              ) : (
                <>
                  <span>Create Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
