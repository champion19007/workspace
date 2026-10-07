import { z } from 'zod';
import { ValidationError } from '../errors/index.js';

export const CursorPayloadSchema = z.object({
  id: z.string(),
  val: z.union([z.string(), z.number()]),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type CursorPayload = z.infer<typeof CursorPayloadSchema>;

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursorString: string): CursorPayload {
  try {
    const json = Buffer.from(cursorString, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return CursorPayloadSchema.parse(parsed);
  } catch {
    throw new ValidationError('Invalid pagination cursor');
  }
}

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  updatedSince: z.string().datetime().optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface PageInfo {
  hasNextPage: boolean;
  endCursor?: string;
  totalCount?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pageInfo: PageInfo;
}

/**
 * Builds a paginated response envelope from an array of fetched items (length limit + 1 fetched to detect next page).
 */
export function buildPaginatedResponse<T extends { id: string }>(params: {
  items: T[];
  limit: number;
  getSortValue: (item: T) => string | number;
  direction?: 'asc' | 'desc';
  totalCount?: number;
}): PaginatedResponse<T> {
  const { items, limit, getSortValue, direction = 'asc', totalCount } = params;
  const hasNextPage = items.length > limit;
  const resultItems = hasNextPage ? items.slice(0, limit) : items;

  let endCursor: string | undefined;
  if (resultItems.length > 0) {
    const lastItem = resultItems[resultItems.length - 1];
    if (lastItem) {
      endCursor = encodeCursor({
        id: lastItem.id,
        val: getSortValue(lastItem),
        dir: direction,
      });
    }
  }

  return {
    items: resultItems,
    pageInfo: {
      hasNextPage,
      ...(endCursor ? { endCursor } : {}),
      ...(totalCount !== undefined ? { totalCount } : {}),
    },
  };
}
