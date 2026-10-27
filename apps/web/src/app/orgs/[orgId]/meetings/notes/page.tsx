'use client';

import React, { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FileUp, Sparkles } from 'lucide-react';
import { MAX_TRANSCRIPT_CHARS, type TranscriptNotesDTO } from '@workspace/core';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/states';
import { SafeMarkdownView } from '@/components/docs/SafeMarkdownView';
import { useShell } from '@/components/shell/shell-context';

function notesMarkdown(title: string, notes: TranscriptNotesDTO): string {
  const list = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
  return [
    `# ${title}`,
    notes.summaryMd,
    notes.decisions.length ? `## Decisions\n\n${list(notes.decisions)}` : '',
    notes.openQuestions.length ? `## Open questions\n\n${list(notes.openQuestions)}` : '',
    notes.actionItems.length
      ? `## Action items\n\n${notes.actionItems
          .map((a) => `- [ ] ${a.text}${a.ownerName || a.duePhrase ? ` (${[a.ownerName, a.duePhrase].filter(Boolean).join(', ')})` : ''}`)
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Paste a transcript or notes from any meeting: AI writes the notes and suggests tasks for you to pick. */
export default function TranscriptNotesPage() {
  const orgId = useParams()?.orgId as string;
  const ids = useId();
  const { projects, refreshProjects } = useShell();
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [notes, setNotes] = useState<TranscriptNotesDTO | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saveDoc, setSaveDoc] = useState(true);
  const [busy, setBusy] = useState<'writing' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ tasks: number; docHref: string | null } | null>(null);

  useEffect(() => {
    if (!projectId && projects?.length) setProjectId(projects[0]!.id);
  }, [projects, projectId]);

  const write = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('writing');
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/ai/meeting-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title, transcript }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "The notes couldn't be written.");
      setNotes(body);
      setPicked(new Set(body.actionItems.map((_: unknown, i: number) => i)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!notes) return;
    setBusy('saving');
    setError(null);
    let tasks = 0;
    let docHref: string | null = null;
    try {
      for (const i of [...picked].sort((a, b) => a - b)) {
        const item = notes.actionItems[i]!;
        const hints = [item.ownerName && `Owner mentioned: ${item.ownerName}.`, item.duePhrase && `When: ${item.duePhrase}.`].filter(Boolean).join(' ');
        const res = await fetch(`/api/orgs/${orgId}/projects/${projectId}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.text.slice(0, 500),
            status: 'todo',
            priority: 'medium',
            description: `From the meeting "${title}". ${hints}\n\n> ${item.quote}`.trim(),
          }),
        });
        if (!res.ok) throw new Error(`Created ${tasks} of ${picked.size} tasks; the next one failed.`);
        tasks++;
      }
      if (saveDoc) {
        const res = await fetch(`/api/orgs/${orgId}/docs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: projectId, title: `${title} notes`.slice(0, 200), bodyMd: notesMarkdown(title, notes) }),
        });
        const doc = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Created ${tasks} tasks, but the notes doc couldn't be saved.`);
        docHref = `/orgs/${orgId}/projects/${projectId}/docs/${doc.id}`;
      }
      setSaved({ tasks, docHref });
      refreshProjects();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const startOver = () => {
    setNotes(null);
    setSaved(null);
    setTranscript('');
    setTitle('');
  };

  const projectName = projects?.find((p) => p.id === projectId)?.name ?? 'the project';

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Notes from a transcript"
        description="Paste the transcript or rough notes from any meeting (Zoom, Google Meet, Teams or in person). AI writes the notes and suggests tasks; you choose what to keep."
      />

      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      {saved ? (
        <Alert tone="success" title="Saved">
          <p>
            {saved.tasks} {saved.tasks === 1 ? 'task was' : 'tasks were'} added to{' '}
            <Link href={`/orgs/${orgId}/projects/${projectId}/tasks`} className="font-medium underline">
              {projectName}
            </Link>
            {saved.docHref && (
              <>
                , and the notes are in{' '}
                <Link href={saved.docHref} className="font-medium underline">
                  a doc
                </Link>
              </>
            )}
            .
          </p>
          <button type="button" onClick={startOver} className="btn btn-secondary btn-sm mt-2">
            Add another meeting
          </button>
        </Alert>
      ) : !notes ? (
        <form onSubmit={write} className="card space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${ids}-title`} className="label">
                Meeting name
              </label>
              <input id={`${ids}-title`} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly check-in with Acme" className="field" />
            </div>
            <div>
              <label htmlFor={`${ids}-project`} className="label">
                Project
              </label>
              <select id={`${ids}-project`} required value={projectId} onChange={(e) => setProjectId(e.target.value)} className="field">
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${ids}-transcript`} className="label">
                Transcript or notes
              </label>
              <label className="mb-1.5 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent-text hover:underline">
                <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                Open a .txt or .vtt file
                <input
                  type="file"
                  accept=".txt,.vtt,text/plain,text/vtt"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setTranscript((await file.text()).slice(0, MAX_TRANSCRIPT_CHARS));
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <textarea
              id={`${ids}-transcript`}
              required
              rows={12}
              maxLength={MAX_TRANSCRIPT_CHARS}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={'Priya: Can we launch on Friday?\nArjun: Yes. I will send the final designs by Wednesday.'}
              className="field resize-y font-mono text-xs"
            />
            <p className="mt-1 text-xs text-fg-muted">
              Lines like “Name: what they said” help AI tell who promised what. Up to {MAX_TRANSCRIPT_CHARS.toLocaleString()} characters.
            </p>
          </div>
          <button type="submit" disabled={busy !== null || !projectId} className="btn btn-primary">
            <Sparkles aria-hidden="true" />
            {busy === 'writing' ? 'Writing notes…' : 'Write the notes'}
          </button>
        </form>
      ) : (
        <div className="space-y-5">
          {notes.demo && (
            <Alert tone="warning" title="Demo notes">
              No AI key is set on this server, so these notes are placeholders picked from your text.
            </Alert>
          )}
          <section className="card space-y-4 p-5" aria-label="Notes">
            <SafeMarkdownView content={notes.summaryMd || '_No summary._'} />
            {notes.decisions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-fg">Decisions</h2>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg">
                  {notes.decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            {notes.openQuestions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-fg">Open questions</h2>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg">
                  {notes.openQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="card space-y-3 p-5" aria-labelledby={`${ids}-tasks`}>
            <h2 id={`${ids}-tasks`} className="text-sm font-semibold text-fg">
              Suggested tasks <span className="font-normal text-fg-muted">{notes.actionItems.length}</span>
            </h2>
            {notes.actionItems.length === 0 ? (
              <p className="text-sm text-fg-muted">Nobody promised anything specific in this meeting.</p>
            ) : (
              <ul className="space-y-2">
                {notes.actionItems.map((a, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={picked.has(i)}
                        onChange={() =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                        className="mt-1"
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="block text-sm font-medium text-fg">{a.text}</span>
                        {(a.ownerName || a.duePhrase) && (
                          <span className="block text-xs text-fg-muted">{[a.ownerName && `Owner: ${a.ownerName}`, a.duePhrase && `When: ${a.duePhrase}`].filter(Boolean).join(' · ')}</span>
                        )}
                        <span className="block text-xs italic text-fg-subtle">“{a.quote}”</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <label className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={saveDoc} onChange={(e) => setSaveDoc(e.target.checked)} />
              Save these notes as a doc in {projectName}
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={save} disabled={busy !== null || (picked.size === 0 && !saveDoc)} className="btn btn-primary">
                {busy === 'saving' ? 'Saving…' : picked.size > 0 ? `Create ${picked.size} ${picked.size === 1 ? 'task' : 'tasks'}${saveDoc ? ' and save notes' : ''}` : 'Save notes'}
              </button>
              <button type="button" onClick={() => setNotes(null)} disabled={busy !== null} className="btn btn-ghost">
                Back to the transcript
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
