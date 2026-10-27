import { z } from 'zod';
import type { PersonDTO } from '../comments/index.js';

// ponytail: uploads pass through the web server, and Vercel caps a request body at 4.5 MB. Switch to signed
// direct-to-storage uploads (BlobStorePort.getUploadUrl) when people need bigger files.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const ListFilesQuerySchema = z
  .object({
    nodeId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
  })
  .refine((q) => q.nodeId || q.taskId, 'Choose a project or a task');

export const UploadFileFieldsSchema = z.object({
  nodeId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
});

export interface FileDTO {
  id: string;
  nodeId: string;
  taskId: string | null;
  /** For a task attachment, the task it belongs to, e.g. "ENG-12 Fix login". */
  taskLabel: string | null;
  name: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: PersonDTO | null;
  createdAt: string;
  canDelete: boolean;
}

/** A file name safe to store and to send back in a download header: no folders, control characters or quotes. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  return Array.from(cleaned).slice(0, 200).join('') || 'file';
}

/** Raster images are shown in the browser; every other type downloads, so an uploaded page can't run as ours. */
export const INLINE_FILE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
