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
      <header className="border-b border-border-subtle pb-6 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Workspace v1</h1>
            <span className="inline-flex items-center rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-semibold text-accent border border-accent/40">
              Stage 4: Application Shell &amp; UI Active
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            AI-native team collaboration, evidence-backed action items, and strict tenant isolation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:opacity-90 text-xs font-bold text-accent-foreground shadow-md transition-opacity"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </Link>
          <Link
            href="/orgs"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-panel-elevated hover:bg-panel border border-border-subtle text-xs font-semibold text-foreground transition-colors"
          >
            <Building2 className="w-3.5 h-3.5 text-accent" />
            <span>Workspaces</span>
          </Link>
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-panel p-6 rounded-2xl border border-border-subtle shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Layout className="w-4 h-4 text-accent" />
            <span>Application Shell</span>
          </div>
          <div className="text-base font-bold text-foreground">Dark Charcoal &amp; Dynamic Accent</div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Persistent 320px desktop sidebar, responsive drawer, view switchers, custom accent picker, and WCAG 2.1 AA compliance.
          </p>
        </div>

        <div className="bg-panel p-6 rounded-2xl border border-border-subtle shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>PostgreSQL Isolation</span>
          </div>
          <div className="text-base font-bold text-foreground">Forced Multi-Tenant RLS</div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            22 tenant tables with org_id, transaction-scoped session context, and compound foreign keys preventing data leakage.
          </p>
        </div>

        <div className="bg-panel p-6 rounded-2xl border border-border-subtle shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="w-4 h-4 text-accent" />
            <span>Roadmap Progress</span>
          </div>
          <div className="text-base font-bold text-foreground">Stage 4 of 25 (16%)</div>
          <div className="w-full bg-panel-inset rounded-full h-2 mt-3 overflow-hidden">
            <div className="bg-accent h-2 rounded-full w-[16%] transition-all duration-500"></div>
          </div>
        </div>
      </div>

      {/* Port Interfaces Table */}
      <section className="bg-panel rounded-2xl border border-border-subtle shadow-sm p-6 mb-8">
        <h2 className="text-base font-semibold text-foreground mb-1">Five Architectural Ports</h2>
        <p className="text-xs text-muted-foreground mb-4">
          All external systems interact through strict port interfaces. Domain logic never branches on provider names.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="border-b border-border-subtle text-[11px] font-semibold text-muted-foreground uppercase bg-panel-inset">
              <tr>
                <th className="py-3 px-4">Port Name</th>
                <th className="py-3 px-4">Core Interface</th>
                <th className="py-3 px-4">Architecture A (PaaS)</th>
                <th className="py-3 px-4">Architecture B (AWS)</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/60">
              {ports.map((p) => (
                <tr key={p.name} className="hover:bg-panel-elevated/40 transition-colors">
                  <td className="py-3 px-4 font-semibold text-foreground">{p.name}</td>
                  <td className="py-3 px-4 font-mono text-[11px] text-accent">{p.port}</td>
                  <td className="py-3 px-4 text-muted-foreground">{p.archA}</td>
                  <td className="py-3 px-4 text-muted-foreground">{p.archB}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
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
      <section className="border border-border-subtle bg-panel-inset rounded-2xl p-5 text-xs text-muted-foreground">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-accent" />
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
