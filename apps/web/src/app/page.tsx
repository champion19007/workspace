import Link from 'next/link';
import { LogIn, Building2, Layout, Sparkles, ShieldCheck } from 'lucide-react';

export default function HomePage() {
  const ports = [
    { name: 'Queue', port: 'QueuePort', archA: 'pg-boss (Supabase)', archB: 'Amazon SQS + DLQ', active: 'Initialized' },
    { name: 'Realtime', port: 'RealtimePort', archA: 'Supabase Realtime Broadcast', archB: 'AWS AppSync Events', active: 'Initialized' },
    { name: 'LLM', port: 'LLMPort', archA: 'Anthropic API (Claude)', archB: 'Amazon Bedrock (India Profile)', active: 'Initialized' },
    { name: 'BlobStore', port: 'BlobStorePort', archA: 'Supabase Storage', archB: 'Amazon S3 (ap-south-1)', active: 'Initialized' },
    { name: 'Auth', port: 'AuthPort', archA: 'Supabase Auth (Passwordless)', archB: 'Amazon Cognito (Passwordless)', active: 'Active' },
  ];

  return (
    <main className="max-w-5xl mx-auto py-12 px-6">
      {/* Header */}
      <header className="border-b border-border pb-6 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Workspace v1</h1>
            <span className="inline-flex items-center rounded-full bg-accent-subtle px-2.5 py-0.5 text-xs font-semibold text-accent-text border border-accent/40">
              Stage 4: Application Shell &amp; UI Active
            </span>
          </div>
          <p className="text-sm text-fg-muted mt-1">
            AI-native team collaboration, evidence-backed action items, and strict tenant isolation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:opacity-90 text-xs font-semibold text-accent-fg shadow-md transition-opacity"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </Link>
          <Link
            href="/orgs"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface border border-border text-xs font-semibold text-fg transition-colors"
          >
            <Building2 className="w-3.5 h-3.5 text-accent-text" />
            <span>Workspaces</span>
          </Link>
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-surface p-6 rounded-xl border border-border shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
            <Layout className="w-4 h-4 text-accent-text" />
            <span>Application Shell</span>
          </div>
          <div className="text-base font-semibold text-fg">Dark Charcoal &amp; Dynamic Accent</div>
          <p className="text-xs text-fg-muted leading-relaxed">
            Persistent 320px desktop sidebar, responsive drawer, view switchers, custom accent picker, and WCAG 2.1 AA compliance.
          </p>
        </div>

        <div className="bg-surface p-6 rounded-xl border border-border shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
            <ShieldCheck className="w-4 h-4 text-success" />
            <span>PostgreSQL Isolation</span>
          </div>
          <div className="text-base font-semibold text-fg">Forced Multi-Tenant RLS</div>
          <p className="text-xs text-fg-muted leading-relaxed">
            22 tenant tables with org_id, transaction-scoped session context, and compound foreign keys preventing data leakage.
          </p>
        </div>

        <div className="bg-surface p-6 rounded-xl border border-border shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
            <Sparkles className="w-4 h-4 text-accent-text" />
            <span>Roadmap Progress</span>
          </div>
          <div className="text-base font-semibold text-fg">Stage 4 of 25 (16%)</div>
          <div className="w-full bg-surface-2 rounded-full h-2 mt-3 overflow-hidden">
            <div className="bg-accent h-2 rounded-full w-[16%] transition-all duration-500"></div>
          </div>
        </div>
      </div>

      {/* Port Interfaces Table */}
      <section className="bg-surface rounded-xl border border-border shadow-sm p-6 mb-8">
        <h2 className="text-base font-semibold text-fg mb-1">Five Architectural Ports</h2>
        <p className="text-xs text-fg-muted mb-4">
          All external systems interact through strict port interfaces. Domain logic never branches on provider names.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="border-b border-border text-xs font-semibold text-fg-muted bg-surface-2">
              <tr>
                <th className="py-3 px-4">Port Name</th>
                <th className="py-3 px-4">Core Interface</th>
                <th className="py-3 px-4">Architecture A (PaaS)</th>
                <th className="py-3 px-4">Architecture B (AWS)</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ports.map((p) => (
                <tr key={p.name} className="hover:bg-surface-2 transition-colors">
                  <td className="py-3 px-4 font-semibold text-fg">{p.name}</td>
                  <td className="py-3 px-4 font-mono text-xs text-accent-text">{p.port}</td>
                  <td className="py-3 px-4 text-fg-muted">{p.archA}</td>
                  <td className="py-3 px-4 text-fg-muted">{p.archB}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-success-subtle text-success border border-success/30">
                      {p.active}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Truthful Foundation State */}
      <section className="border border-border bg-surface-2 rounded-xl p-5 text-xs text-fg-muted">
        <h3 className="font-semibold text-fg flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-accent-text" />
          <span>Human-in-the-Loop Task Guard</span>
        </h3>
        <p className="leading-relaxed">
          Zero simulated data or hallucinated tasks: AI-generated meeting notes and action items strictly require explicit
          human approval before task rows are written to the database.
        </p>
      </section>
    </main>
  );
}
