'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CommentDTO, CommentTargetType, PersonDTO } from '@workspace/core';
import { Avatar } from '@/components/ui/avatar';
import { Alert } from '@/components/ui/states';
import { formatRelativeTime } from '@/lib/format';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The comment's text with each @mention highlighted. */
function renderBody(body: string, mentions: PersonDTO[]): React.ReactNode {
  if (mentions.length === 0) return body;
  const tokens = mentions.map((m) => `@${m.name}`).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'g');
  return body.split(pattern).map((part, i) =>
    tokens.includes(part) ? (
      <span key={i} className="font-medium text-accent-text">
        {part}
      </span>
    ) : (
      part
    )
  );
}

/** The word being typed right before the cursor, when it starts with @. */
const mentionQuery = (textBeforeCaret: string) => /(?:^|\s)@([^\s@]{0,30})$/.exec(textBeforeCaret)?.[1] ?? null;

/** Comments on a task, a project's Discussion or a doc, with @mentions. */
export function CommentThread({
  orgId,
  targetType,
  targetId,
  heading = 'Comments',
  emptyText = 'No comments yet.',
  hint,
}: {
  orgId: string;
  targetType: CommentTargetType;
  targetId: string;
  heading?: string;
  emptyText?: string;
  /** Shown under the box, e.g. who can read the comments. */
  hint?: string;
}) {
  const ids = useId();
  const [comments, setComments] = useState<CommentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<PersonDTO[]>([]);
  const [people, setPeople] = useState<PersonDTO[] | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const target = `targetType=${targetType}&targetId=${targetId}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/comments?${target}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || "Comments couldn't be loaded.");
      setComments(body.comments);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [orgId, target]);

  useEffect(() => {
    setComments(null);
    setPeople(null);
    load();
  }, [load]);

  const matches =
    query === null || !people
      ? []
      : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const onDraftChange = (value: string, caret: number) => {
    setDraft(value);
    const q = mentionQuery(value.slice(0, caret));
    setQuery(q);
    setHighlight(0);
    if (q !== null && people === null) {
      setPeople([]);
      fetch(`/api/orgs/${orgId}/comments/mentionable?${target}`)
        .then((res) => (res.ok ? res.json() : { people: [] }))
        .then((data) => setPeople(data.people ?? []))
        .catch(() => {});
    }
  };

  const pick = (person: PersonDTO) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${person.name} `);
    setDraft(before + draft.slice(caret));
    setMentions((prev) => (prev.some((m) => m.id === person.id) ? prev : [...prev, person]));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const submit = async () => {
    const bodyMd = draft.trim();
    if (!bodyMd || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId,
          bodyMd,
          // Only people whose @name is still in the text.
          mentions: mentions.filter((m) => bodyMd.includes(`@${m.name}`)).map((m) => m.id),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Your comment couldn't be posted.");
      setComments((prev) => [...(prev ?? []), data]);
      setDraft('');
      setMentions([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const remove = async (comment: CommentDTO) => {
    if (!confirm('Delete this comment?')) return;
    const res = await fetch(`/api/orgs/${orgId}/comments/${comment.id}`, { method: 'DELETE' });
    if (res.ok) setComments((prev) => prev?.filter((c) => c.id !== comment.id) ?? null);
    else setError("The comment couldn't be deleted.");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setHighlight((h) => (h + step + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[highlight]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section aria-labelledby={`${ids}-heading`} className="space-y-3">
      <h3 id={`${ids}-heading`} className="text-sm font-semibold text-fg">
        {heading} {comments && <span className="font-normal text-fg-muted">{comments.length}</span>}
      </h3>

      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      {comments === null ? (
        <div className="skeleton h-14 w-full" />
      ) : comments.length === 0 ? (
        <p className="text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <ol className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="group flex gap-2.5">
              <Avatar name={c.author.name} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-fg">{c.author.name}</span>
                  <time dateTime={c.createdAt} className="text-xs text-fg-subtle">
                    {formatRelativeTime(c.createdAt)}
                  </time>
                  {c.canDelete && (
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      aria-label="Delete comment"
                      title="Delete comment"
                      className="btn btn-ghost btn-icon ml-auto h-6 w-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [&_svg]:h-3.5 [&_svg]:w-3.5"
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">{renderBody(c.bodyMd, c.mentions)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="relative">
        <label htmlFor={`${ids}-draft`} className="sr-only">
          Write a comment
        </label>
        <textarea
          ref={textareaRef}
          id={`${ids}-draft`}
          rows={2}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          placeholder="Write a comment. Type @ to mention someone."
          aria-autocomplete="list"
          aria-controls={matches.length > 0 ? `${ids}-mentions` : undefined}
          aria-activedescendant={matches.length > 0 ? `${ids}-option-${highlight}` : undefined}
          className="field resize-y"
        />
        {matches.length > 0 && (
          <ul id={`${ids}-mentions`} role="listbox" aria-label="People you can mention" className="menu bottom-full left-0 mb-1 max-h-56 w-64 overflow-auto">
            {matches.map((p, i) => (
              <li
                key={p.id}
                id={`${ids}-option-${i}`}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={`menu-item cursor-pointer ${i === highlight ? 'bg-surface-2' : ''}`}
              >
                <Avatar name={p.name} size="xs" />
                <span className="truncate">{p.name}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-fg-subtle">{hint}</p>
          <button type="button" onClick={submit} disabled={!draft.trim() || sending} className="btn btn-primary btn-sm shrink-0">
            {sending ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </section>
  );
}
