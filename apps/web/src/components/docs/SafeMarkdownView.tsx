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

/**
 * Pure React Markdown renderer immune to XSS injection.
 * Does NOT use dangerouslySetInnerHTML with arbitrary HTML.
 */
export function SafeMarkdownView({ content, className = '' }: SafeMarkdownViewProps) {
  if (!content) {
    return <p className="text-xs text-muted-foreground italic">No content in this document yet.</p>;
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
        className={`my-3 pl-6 space-y-1 text-xs text-foreground/90 ${
          isNumberedList ? 'list-decimal' : 'list-disc'
        }`}
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
      <div
        key={`code-${elements.length}`}
        className="my-3 rounded-xl bg-panel-inset border border-border-subtle p-3 overflow-x-auto font-mono text-[11px] text-foreground leading-relaxed"
      >
        {codeBlockLang && (
          <div className="text-[10px] uppercase font-semibold text-accent/70 mb-1.5 pb-1 border-b border-border-subtle/50">
            {codeBlockLang}
          </div>
        )}
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
    const line = lines[idx];

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

    // 3. Headings (#, ##, ###, ####)
    if (line.startsWith('# ')) {
      flushList();
      elements.push(
        <h1
          key={`h1-${idx}`}
          className="text-lg lg:text-xl font-bold text-foreground tracking-tight mt-6 mb-3 border-b border-border-subtle/60 pb-1.5"
        >
          {renderInlineFormatting(line.slice(2))}
        </h1>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h2
          key={`h2-${idx}`}
          className="text-base lg:text-lg font-bold text-foreground tracking-tight mt-5 mb-2"
        >
          {renderInlineFormatting(line.slice(3))}
        </h2>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h3
          key={`h3-${idx}`}
          className="text-sm font-semibold text-foreground tracking-tight mt-4 mb-1.5"
        >
          {renderInlineFormatting(line.slice(4))}
        </h3>
      );
      continue;
    }
    if (line.startsWith('#### ')) {
      flushList();
      elements.push(
        <h4
          key={`h4-${idx}`}
          className="text-xs font-semibold text-foreground uppercase tracking-wider mt-3 mb-1 text-accent"
        >
          {renderInlineFormatting(line.slice(5))}
        </h4>
      );
      continue;
    }

    // 4. Horizontal Rule (--- or ***)
    if (line.trim() === '---' || line.trim() === '***') {
      flushList();
      elements.push(<hr key={`hr-${idx}`} className="my-4 border-border-subtle" />);
      continue;
    }

    // 5. Blockquote (> )
    if (line.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote
          key={`quote-${idx}`}
          className="my-3 border-l-2 border-accent pl-3 py-0.5 text-xs text-muted-foreground italic bg-panel-inset/40 rounded-r-lg"
        >
          {renderInlineFormatting(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // 6. Checklists (- [ ] or - [x])
    const checklistMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (checklistMatch) {
      flushList();
      const isChecked = checklistMatch[1].toLowerCase() === 'x';
      const text = checklistMatch[2];
      elements.push(
        <div key={`check-${idx}`} className="flex items-center gap-2 my-1.5 text-xs text-foreground/90">
          <input
            type="checkbox"
            checked={isChecked}
            readOnly
            className="w-3.5 h-3.5 rounded bg-panel-inset border-border-subtle text-accent focus:ring-accent"
          />
          <span className={isChecked ? 'line-through text-muted-foreground' : ''}>
            {renderInlineFormatting(text)}
          </span>
        </div>
      );
      continue;
    }

    // 7. Unordered Lists (- or *)
    if (line.match(/^[-*]\s+/)) {
      if (!inList || isNumberedList) {
        flushList();
        inList = true;
        isNumberedList = false;
      }
      listItems.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }

    // 8. Ordered Lists (1. , 2. )
    if (line.match(/^\d+\.\s+/)) {
      if (!inList || !isNumberedList) {
        flushList();
        inList = true;
        isNumberedList = true;
      }
      listItems.push(line.replace(/^\d+\.\s+/, ''));
      continue;
    }

    // 9. Standard Paragraph
    flushList();
    elements.push(
      <p key={`p-${idx}`} className="my-2 text-xs text-foreground/90 leading-relaxed">
        {renderInlineFormatting(line)}
      </p>
    );
  }

  // Flush remaining
  flushList();
  flushCodeBlock();

  return <div className={`space-y-1 break-words ${className}`}>{elements}</div>;
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
      const rawUrl = linkMatch[2];
      if (isSafeUrl(rawUrl)) {
        return (
          <a
            key={i}
            href={rawUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2 hover:opacity-80 transition-opacity font-medium"
          >
            {label}
          </a>
        );
      }
      // Block unsafe URLs safely
      return (
        <span key={i} className="text-muted-foreground line-through" title="Blocked unsafe link">
          {label}
        </span>
      );
    }

    // 2. Inline Code: `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded bg-panel-inset border border-border-subtle font-mono text-[11px] text-accent"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // 3. Bold: **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={i} className="font-bold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }

    // 4. Italic: *text*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={i} className="italic text-foreground/90">
          {part.slice(1, -1)}
        </em>
      );
    }

    return part;
  });
}
