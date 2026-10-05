export default function HomePage() {
  const ports = [
    { name: 'Queue', port: 'QueuePort', archA: 'pg-boss (Supabase)', archB: 'Amazon SQS + DLQ', active: 'Initialized' },
    { name: 'Realtime', port: 'RealtimePort', archA: 'Supabase Realtime Broadcast', archB: 'AWS AppSync Events', active: 'Initialized' },
    { name: 'LLM', port: 'LLMPort', archA: 'Anthropic API (Claude)', archB: 'Amazon Bedrock (India Profile)', active: 'Initialized' },
    { name: 'BlobStore', port: 'BlobStorePort', archA: 'Supabase Storage', archB: 'Amazon S3 (ap-south-1)', active: 'Initialized' },
    { name: 'Auth', port: 'AuthPort', archA: 'Supabase Auth (Passwordless)', archB: 'Amazon Cognito (Passwordless)', active: 'Initialized' },
  ];

  return (
    <main className="max-w-5xl mx-auto py-12 px-6">
      {/* Header */}
      <header className="border-b border-slate-200 pb-6 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Workspace v1</h1>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              Stage 1: Foundation Active
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Solo-build modular monolith baseline (Jan 2027 Production Beta).
          </p>
        </div>
        <div className="text-xs font-mono bg-slate-100 rounded px-3 py-2 text-slate-600 border border-slate-200">
          Root: apps/web &middot; Node.js v24 &middot; Strict TypeScript
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Architecture Tier</div>
          <div className="text-lg font-semibold text-slate-800 mt-1">Architecture A &rarr; B Ready</div>
          <p className="text-xs text-slate-500 mt-2">
            Shared domain core in <code className="font-mono text-slate-700">packages/core</code> with zero cloud SDK leakage.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Database Engine</div>
          <div className="text-lg font-semibold text-slate-800 mt-1">PostgreSQL 16</div>
          <p className="text-xs text-slate-500 mt-2">
            Dual pools: API transaction pooler (10) + Worker session direct (5). Extensions: <code className="font-mono">ltree</code>, <code className="font-mono">citext</code>, <code className="font-mono">pgvector</code>.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Roadmap Progress</div>
          <div className="text-lg font-semibold text-slate-800 mt-1">Stage 1 of 25 (4%)</div>
          <div className="w-full bg-slate-100 rounded-full h-2 mt-3">
            <div className="bg-blue-600 h-2 rounded-full w-[4%]"></div>
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
                  <td className="py-3 px-4 font-mono text-xs text-blue-600">{p.port}</td>
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

      {/* Honest Application State Disclosure */}
      <section className="border border-amber-200 bg-amber-50/60 rounded-lg p-5 text-sm text-amber-900">
        <h3 className="font-semibold text-amber-950 flex items-center gap-2">
          <span>Truthful Foundation State</span>
        </h3>
        <p className="mt-1 text-xs text-amber-800 leading-relaxed">
          Zero simulated data or mock metrics: in accordance with the specification, Workspace v1 creates no fake meetings,
          fake tasks, or dummy analytics. All suggested action items strictly require human approval before task creation.
        </p>
      </section>
    </main>
  );
}
