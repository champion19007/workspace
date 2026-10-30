'use client';

import React from 'react';

interface SafeMarkdownViewProps {
  content: string;
  className?: string;
}

/**
 * Validates whether a URL scheme is safe to render as a link.
 * Blocks javascript:, vbscript:, data:, and other executable URI schemes.
 */
function isSafeUrl(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('vbscript:') ||
    trimmed.startsWith('data:')
  ) {
    return false;
  }
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#')
  );
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/**
 * Pure React Markdown renderer immune to XSS injection.
 * Does NOT use dangerouslySetInnerHTML with arbitrary HTML.
 */
export function SafeMarkdownView({ content, className = '' }: SafeMarkdownViewProps) {
  if (!content) {
    return <p className="text-sm italic text-fg-muted">This doc is empty.</p>;
  }

  // Parse lines
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];

  let inList = false;
  let listItems: string[] = [];
  let isNumberedList = false;

  const flushList = () => {
    if (!inList || listItems.length === 0) return;
    const ListTag = isNumberedList ? 'ol' : 'ul';
    elements.push(
      <ListTag
        key={`list-${elements.length}`}
        className={`my-3 space-y-1 pl-6 marker:text-fg-subtle ${isNumberedList ? 'list-decimal' : 'list-disc'}`}
      >
        {listItems.map((item, i) => (
          <li key={i}>{renderInlineFormatting(item)}</li>
        ))}
      </ListTag>
    );
    inList = false;
    listItems = [];
    isNumberedList = false;
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    elements.push(
      <div key={`code-${elements.length}`} className="my-4 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[13px] leading-relaxed">
        {codeBlockLang && <div className="mb-1.5 text-xs font-medium text-fg-muted">{codeBlockLang}</div>}
        <pre>
          <code>{codeBlockLines.join('\n')}</code>
        </pre>
      </div>
    );
    inCodeBlock = false;
    codeBlockLang = '';
    codeBlockLines = [];
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;

    // 1. Code Block Fence (```)
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        flushList();
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // 2. Empty line -> flush lists and spacing
    if (line.trim() === '') {
      flushList();
      continue;
    }

    // 3. Table: a pipe row followed by a |---|---| separator row.
    // ponytail: no per-column alignment or escaped pipes; add if docs need them.
    if (line.includes('|') && TABLE_SEPARATOR.test(lines[idx + 1] ?? '')) {
      flushList();
      const header = tableCells(line);
      const rows: string[][] = [];
      idx += 2;
      while (idx < lines.length && lines[idx]!.includes('|') && lines[idx]!.trim() !== '') {
        rows.push(tableCells(lines[idx]!));
        idx++;
      }
      idx--;
      elements.push(
        <div key={`table-${idx}`} className="my-4 overflow-x-auto rounded-lg border border-border">
          <table className="table">
            <thead>
              <tr>
                {header.map((cell, i) => (
                  <th key={i}>{renderInlineFormatting(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {header.map((_, c) => (
                    <td key={c} className="py-2">
                      {renderInlineFormatting(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 4. Headings (#, ##, ###, ####)
    const heading = line.match(/^(#{1,4}) (.*)$/);
    if (heading) {
      flushList();
      const level = heading[1]!.length;
      const text = renderInlineFormatting(heading[2]!);
      const classes = [
        'mb-3 mt-6 text-xl font-semibold tracking-tight first:mt-0',
        'mb-2 mt-6 text-base font-semibold first:mt-0',
        'mb-1.5 mt-5 text-sm font-semibold first:mt-0',
        'mb-1 mt-4 text-sm font-medium text-fg-muted first:mt-0',
      ];
      const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[level - 1]!;
      elements.push(
        <Tag key={`h-${idx}`} className={`text-balance text-fg ${classes[level - 1]}`}>
          {text}
        </Tag>
      );
      continue;
    }

    // 5. Horizontal Rule (--- or ***)
    if (line.trim() === '---' || line.trim() === '***') {
      flushList();
      elements.push(<hr key={`hr-${idx}`} className="my-6 border-border" />);
      continue;
    }

    // 6. Blockquote (> )
    if (line.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote key={`quote-${idx}`} className="my-3 border-l-2 border-border-strong pl-3 text-fg-muted">
          {renderInlineFormatting(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // 7. Checklists (- [ ] or - [x])
    const checklistMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (checklistMatch) {
      flushList();
      const isChecked = checklistMatch[1]!.toLowerCase() === 'x';
      const text = checklistMatch[2]!;
      elements.push(
        <div key={`check-${idx}`} className="my-1.5 flex items-start gap-2">
          <input type="checkbox" checked={isChecked} readOnly aria-label={text} className="mt-1 h-3.5 w-3.5" />
          <span className={isChecked ? 'text-fg-muted line-through' : ''}>{renderInlineFormatting(text)}</span>
        </div>
      );
      continue;
    }

    // 8. Unordered Lists (- or *)
    if (line.match(/^[-*]\s+/)) {
      if (!inList || isNumberedList) {
        flushList();
        inList = true;
        isNumberedList = false;
      }
      listItems.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }

    // 9. Ordered Lists (1. , 2. )
    if (line.match(/^\d+\.\s+/)) {
      if (!inList || !isNumberedList) {
        flushList();
        inList = true;
        isNumberedList = true;
      }
      listItems.push(line.replace(/^\d+\.\s+/, ''));
      continue;
    }

    // 10. Standard Paragraph
    flushList();
    elements.push(
      <p key={`p-${idx}`} className="my-2.5">
        {renderInlineFormatting(line)}
      </p>
    );
  }

  // Flush remaining
  flushList();
  flushCodeBlock();

  return <div className={`break-words text-sm leading-relaxed text-fg ${className}`}>{elements}</div>;
}

/**
 * Handles inline formatting: bold (**), italic (*), code (`), and links ([text](url))
 */
function renderInlineFormatting(text: string): React.ReactNode {
  if (!text) return '';

  // Regex tokens for [text](url), `code`, **bold**, *italic*
  const tokenRegex = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, i) => {
    // 1. Link: [label](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const label = linkMatch[1];
      const rawUrl = linkMatch[2]!;
      if (isSafeUrl(rawUrl)) {
        return (
          <a key={i} href={rawUrl} target="_blank" rel="noopener noreferrer" className="link underline">
            {label}
          </a>
        );
      }
      // Block unsafe URLs safely
      return (
        <span key={i} className="text-fg-muted line-through" title="Blocked unsafe link">
          {label}
        </span>
      );
    }

    // 2. Inline Code: `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code key={i} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }

    // 3. Bold: **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }

    // 4. Italic: *text*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }

    return part;
  });
}
