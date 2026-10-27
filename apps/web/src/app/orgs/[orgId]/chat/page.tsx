'use client';

import React, { useId, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FileText, FolderKanban, ListTodo, Send } from 'lucide-react';
import type { AskAiAnswerDTO, AskAiSourceDTO } from '@workspace/core';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/states';

const EXAMPLES = ["What's late right now?", 'Which projects need attention, and why?', 'What got finished this week?'];
const KIND_ICON = { project: FolderKanban, task: ListTodo, doc: FileText };

interface Turn {
  question: string;
  answer?: AskAiAnswerDTO;
  error?: string;
}

/** The answer with each [n] turned into a link to that source. */
function AnswerText({ text, sources }: { text: string; sources: AskAiSourceDTO[] }) {
  const byNumber = new Map(sources.map((s) => [String(s.n), s]));
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
      {text.split(/(\[\d+\])/).map((part, i) => {
        const source = byNumber.get(part.slice(1, -1));
        return source && /^\[\d+\]$/.test(part) ? (
          <Link key={i} href={source.href} title={source.title} className="font-medium text-accent-text hover:underline">
            {part}
          </Link>
        ) : (
          part
        )
      })}
    </p>
  );
}

/** Questions about your projects, answered only from what you can see here, with links to the sources. */
export default function AskAiPage() {
  const orgId = useParams()?.orgId as string;
  const ids = useId();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);

  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 3 || asking) return;
    setAsking(true);
    setQuestion('');
    setTurns((prev) => [{ question: text }, ...prev]);
    let turn: Turn;
    try {
      const res = await fetch(`/api/orgs/${orgId}/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Couldn't get an answer.");
      turn = { question: text, answer: body };
    } catch (err) {
      turn = { question: text, error: (err as Error).message };
    }
    setTurns((prev) => [turn, ...prev.slice(1)]);
    setAsking(false);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Ask AI"
        description="Ask about your projects in plain words. Answers come only from what you can see here, with links to where each fact comes from."
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex gap-2"
      >
        <label htmlFor={`${ids}-q`} className="sr-only">
          Your question
        </label>
        <input
          id={`${ids}-q`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="For example: what's late on the website project?"
          className="field"
        />
        <button type="submit" disabled={asking || question.trim().length < 3} className="btn btn-primary shrink-0">
          <Send aria-hidden="true" />
          {asking ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button key={q} type="button" onClick={() => ask(q)} className="btn btn-secondary btn-sm">
              {q}
            </button>
          ))}
        </div>
      )}

      <ol className="space-y-4" aria-live="polite">
        {turns.map((t, i) => (
          <li key={turns.length - i} className="card space-y-3 p-5">
            <p className="text-sm font-medium text-fg">{t.question}</p>
            {t.error ? (
              <Alert>{t.error}</Alert>
            ) : !t.answer ? (
              <div role="status" className="skeleton h-12 w-full">
                <span className="sr-only">Looking for an answer…</span>
              </div>
            ) : (
              <>
                {t.answer.demo && (
                  <p className="text-xs font-medium text-warning">Demo answer: no AI key is set on this server.</p>
                )}
                <AnswerText text={t.answer.answer} sources={t.answer.sources} />
                {t.answer.sources.length > 0 && (
                  <ul className="space-y-1 border-t border-border pt-3">
                    {t.answer.sources.map((s) => {
                      const Icon = KIND_ICON[s.kind];
                      return (
                        <li key={s.n} className="flex items-center gap-2 text-sm">
                          <span className="w-6 shrink-0 text-xs tabular-nums text-fg-subtle">[{s.n}]</span>
                          <Icon className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                          <Link href={s.href} className="truncate text-fg hover:underline">
                            {s.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </li>
        ))}
      </ol>

      <p className="text-xs text-fg-muted">
        Answers are written by AI from your projects, tasks and docs. Check anything important with the team.
      </p>
    </div>
  );
}
