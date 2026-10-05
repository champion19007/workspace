import Link from 'next/link';
import { LogIn, Building2 } from 'lucide-react';

export default function HomePage() {
  const ports = [
    { name: 'Queue', port: 'QueuePort', archA: 'pg-boss (Supabase)', archB: 'Amazon SQS + DLQ', active: 'Initialized' },
    { name: 'Realtime', port: 'RealtimePort', archA: 'Supabase Realtime Broadcast', archB: 'AWS AppSync Events', active: 'Initialized' },
    { name: 'LLM', port: 'LLMPort', archA: 'Anthropic API (Claude)', archB: 'Amazon Bedrock (India Profile)', active: 'Initialized' },
    { name: 'BlobStore', port: 'BlobStorePort', archA: 'Supabase Storage', archB: 'Amazon S3 (ap-south-1)', active: 'Initialized' },
    { name: 'Auth', port: 'AuthPort', archA: 'Supabase Auth (Passwordless)', archB: 'Amazon Cognito (Passwordless)', active: 'Active (Stage 3)' },
  ];

  return (
    <main className="max-w-5xl mx-auto py-12 px-6">
      {/* Header */}
      <header className="border-b border-slate-200 pb-6 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Workspace v1</h1>
            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
              Stage 3: Auth &amp; Multi-Tenancy Active
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            AI-native project management, passwordless server sessions, and strict tenant isolation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </Link>
          <Link
            href="/orgs"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-medium text-slate-700 transition-colors"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Workspaces</span>
          </Link>
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Authentication &amp; Sessions</div>
          <div className="text-lg font-semibold text-slate-800 mt-1">Passwordless + 30-Day Rolling</div>
          <p className="text-xs text-slate-500 mt-2">
            Google OIDC + email magic link. Server httpOnly cookies, zero tokens in localStorage, session_epoch instant revocation.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Database Multi-Tenancy</div>
          <div className="text-lg font-semibold text-slate-800 mt-1">Forced PostgreSQL RLS</div>
          <p className="text-xs text-slate-500 mt-2">
            22 tenant tables with org_id, transaction-scoped isolation, compound foreign keys, and RBAC matrix.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Roadmap Progress</div>
          <div className="text-lg font-semibold text-slate-800 mt-1">Stage 3 of 25 (12%)</div>
          <div className="w-full bg-slate-100 rounded-full h-2 mt-3">
            <div className="bg-indigo-600 h-2 rounded-full w-[12%]"></div>
          </div>
        </div>
      </div>

      {/* Port Interfaces Table */}
      <section className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 mb-8">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Five Main Architectural Ports</h2>
        <p className="text-xs text-slate-500 mb-4">
          All external systems interact through strict port interfaces. Domain logic never branches on provider names.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50">
              <tr>
                <th className="py-3 px-4">Port Name</th>
                <th className="py-3 px-4">Core Interface</th>
                <th className="py-3 px-4">Architecture A (PaaS)</th>
                <th className="py-3 px-4">Architecture B (AWS)</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ports.map((p) => (
                <tr key={p.name} className="hover:bg-slate-50/50">
                  <td className="py-3 px-4 font-medium text-slate-800">{p.name}</td>
                  <td className="py-3 px-4 font-mono text-xs text-indigo-600">{p.port}</td>
                  <td className="py-3 px-4 text-xs text-slate-600">{p.archA}</td>
                  <td className="py-3 px-4 text-xs text-slate-600">{p.archB}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
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
      <section className="border border-amber-200 bg-amber-50/60 rounded-lg p-5 text-sm text-amber-900">
        <h3 className="font-semibold text-amber-950 flex items-center gap-2">
          <span>Truthful State Disclosure</span>
        </h3>
        <p className="mt-1 text-xs text-amber-800 leading-relaxed">
          Zero simulated data or mock metrics: in accordance with the specification, Workspace v1 creates no fake meetings,
          fake tasks, or dummy analytics. All suggested action items strictly require human approval before task creation.
        </p>
      </section>
    </main>
  );
}
