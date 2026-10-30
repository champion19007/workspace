import { z } from 'zod';

// ============================================================================
// Request forms: a public link per project where anyone can ask the team for something
// ============================================================================

/** The shape of the unguessable token in a form's public link (/r/{token}). */
export const REQUEST_FORM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const RequestStatusSchema = z.enum(['new', 'accepted', 'declined']);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const SaveRequestFormSchema = z.object({
  enabled: z.boolean(),
  /** Shown above the form, e.g. what kind of requests the team takes. */
  intro: z.string().trim().max(1000).default(''),
});

export const PublicRequestSchema = z.object({
  title: z.string().trim().min(3, 'Say in a few words what you need').max(200),
  details: z.string().trim().max(5000).default(''),
  name: z.string().trim().min(1, 'Add your name').max(120),
  email: z.string().trim().email('Add an email address the team can reply to').max(255),
  /** A field people never see. Bots fill it in; requests that have it are dropped. */
  website: z.string().optional(),
});
export type PublicRequestInput = z.infer<typeof PublicRequestSchema>;

export const ListRequestsQuerySchema = z.object({
  status: RequestStatusSchema.default('new'),
});

export const DecideRequestSchema = z.object({
  decision: z.enum(['accept', 'decline']),
});

export interface RequestFormDTO {
  nodeId: string;
  enabled: boolean;
  /** The unguessable part of the public link: /r/{token}. */
  token: string;
  intro: string;
}

export interface PublicRequestFormDTO {
  orgName: string;
  projectName: string;
  intro: string;
}

export interface RequestDTO {
  id: string;
  nodeId: string;
  projectName: string;
  title: string;
  details: string;
  requesterName: string;
  requesterEmail: string;
  status: RequestStatus;
  /** The task an accepted request became. */
  taskId: string | null;
  taskKey: string | null;
  createdAt: string;
  decidedAt: string | null;
}
