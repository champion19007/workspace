'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Loader2 } from 'lucide-react';
import { AuthFrame } from '@/components/ui/auth-frame';
import { Alert } from '@/components/ui/states';

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [customSlug, setCustomSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The short name follows the organization name until someone edits it.
  const slug = customSlug ?? slugify(name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "The organization couldn't be created.");

      router.push(`/orgs/${data.org.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <AuthFrame
      icon={Building2}
      title="Create your organization"
      description="An organization holds your team's projects, tasks and meeting notes. You'll be its owner."
      footer={
        <div className="space-y-1">
          <p>Joining an existing team? Ask them for an invitation link.</p>
          <Link href="/orgs" className="link">
            See your organizations
          </Link>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && <Alert tone="danger">{error}</Alert>}

        <div>
          <label htmlFor="orgName" className="label">
            Organization name
          </label>
          <input
            id="orgName"
            type="text"
            required
            minLength={2}
            maxLength={255}
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Inc."
            className="field"
          />
        </div>

        <div>
          <label htmlFor="orgSlug" className="label">
            Short name
          </label>
          <input
            id="orgSlug"
            type="text"
            required
            minLength={2}
            maxLength={64}
            pattern="[a-z0-9-]+"
            value={slug}
            onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="acme"
            aria-describedby="orgSlug-hint"
            className="field font-mono"
          />
          <p id="orgSlug-hint" className="hint">
            A unique ID for your organization: lowercase letters, numbers and hyphens.
          </p>
        </div>

        <button type="submit" disabled={loading || name.trim().length < 2 || slug.length < 2} className="btn btn-primary w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loading ? 'Creating…' : 'Create organization'}
        </button>
      </form>
    </AuthFrame>
  );
}
