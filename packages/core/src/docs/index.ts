import { z } from 'zod';

// ============================================================================
// Constants & Limits
// ============================================================================

export const MAX_DOC_TITLE_LENGTH = 500;
export const MAX_DOC_CONTENT_LENGTH = 500_000; // ~500 KB Markdown
export const MAX_RETAINED_VERSIONS = 30;

// ============================================================================
// Markdown & HTML Sanitizer
// ============================================================================

const SCRIPT_STYLE_BLOCKS_REGEX = /<\s*(script|style)[\s>][\s\S]*?<\/\s*\1\s*>/gi;
const DANGEROUS_TAGS_REGEX = /<\s*\/?\s*(script|iframe|object|embed|applet|form|input|button|select|textarea|style|link|meta|base|svg|math)[^>]*>/gi;
const EVENT_HANDLER_ATTRS_REGEX = /\s+on[a-z]+\s*=\s*(['"][^'"]*['"]|[^\s>]+)/gi;
const JAVASCRIPT_URL_REGEX = /\[([^\]]*)\]\(\s*(?:javascript|vbscript|data):[^)]*\)/gi;
const INLINE_SCRIPT_URI_REGEX = /(href|src)\s*=\s*['"]\s*(?:javascript|vbscript|data):[^'"]*['"]/gi;

/**
 * Sanitizes untrusted Markdown content:
 * - Strips malicious executable HTML tags (<script>, <iframe>, <object>, etc.) and contents
 * - Strips inline JavaScript event handlers (onload, onerror, onclick)
 * - Blocks unsafe URI schemes in markdown links ([click](javascript:...))
 * - Preserves standard markdown semantics (headings, bold, lists, code, safe links)
 */
export function sanitizeMarkdown(input: string): string {
  if (!input) return '';
  return input
    .replace(SCRIPT_STYLE_BLOCKS_REGEX, '')
    .replace(DANGEROUS_TAGS_REGEX, '')
    .replace(EVENT_HANDLER_ATTRS_REGEX, '')
    .replace(JAVASCRIPT_URL_REGEX, '[$1](#blocked-unsafe-url)')
    .replace(INLINE_SCRIPT_URI_REGEX, '$1="#blocked-unsafe-url"');
}

/**
 * Produces a safe plain-text preview excerpt from markdown content
 */
export function extractMarkdownExcerpt(markdown: string, maxLength = 160): string {
  if (!markdown) return '';
  const plainText = markdown
    .replace(/```[\s\S]*?```/g, '') // remove code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/#+\s+/g, '') // headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/[*_~>]/g, '') // formatting
    .replace(/\s+/g, ' ')
    .trim();

  if (plainText.length <= maxLength) return plainText;
  return plainText.slice(0, maxLength).trimEnd() + '...';
}

// ============================================================================
// DTOs
// ============================================================================

export interface DocAuthorDTO {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export interface DocNodeDTO {
  id: string;
  name: string;
  kind: 'team' | 'project';
  visibility: 'public' | 'private';
}

export interface DocDTO {
  id: string;
  orgId: string;
  nodeId: string;
  title: string;
  bodyMd: string;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  creator: DocAuthorDTO | null;
  updater: DocAuthorDTO | null;
  node: DocNodeDTO | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocListItemDTO {
  id: string;
  orgId: string;
  nodeId: string;
  title: string;
  version: number;
  excerpt: string;
  creator: DocAuthorDTO | null;
  updater: DocAuthorDTO | null;
  node: DocNodeDTO | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocVersionDTO {
  id: string;
  orgId: string;
  docId: string;
  version: number;
  title: string;
  bodyMd: string;
  createdBy: string | null;
  creator: DocAuthorDTO | null;
  createdAt: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

export const CreateDocSchema = z.object({
  nodeId: z.string().uuid('Node ID must be a valid UUID'),
  title: z
    .string()
    .trim()
    .min(1, 'Document title is required')
    .max(MAX_DOC_TITLE_LENGTH, `Title cannot exceed ${MAX_DOC_TITLE_LENGTH} characters`),
  bodyMd: z
    .string()
    .max(MAX_DOC_CONTENT_LENGTH, `Document content cannot exceed ${MAX_DOC_CONTENT_LENGTH} characters`)
    .default(''),
});

export type CreateDocInput = z.infer<typeof CreateDocSchema>;

export const UpdateDocSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Document title cannot be empty')
    .max(MAX_DOC_TITLE_LENGTH, `Title cannot exceed ${MAX_DOC_TITLE_LENGTH} characters`)
    .optional(),
  bodyMd: z
    .string()
    .max(MAX_DOC_CONTENT_LENGTH, `Document content cannot exceed ${MAX_DOC_CONTENT_LENGTH} characters`)
    .optional(),
});

export type UpdateDocInput = z.infer<typeof UpdateDocSchema>;

export const RestoreDocSchema = z.object({
  version: z.number().int().min(1, 'Target restore version must be a positive integer'),
});

export type RestoreDocInput = z.infer<typeof RestoreDocSchema>;

export const ListDocsQuerySchema = z.object({
  nodeId: z.string().uuid('Node ID must be a valid UUID').optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ListDocsQuery = z.infer<typeof ListDocsQuerySchema>;
