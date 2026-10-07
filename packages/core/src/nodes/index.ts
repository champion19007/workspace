import { z } from 'zod';

export const NodeKindSchema = z.enum(['team', 'project']);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const NodeVisibilitySchema = z.enum(['public', 'private']);
export type NodeVisibility = z.infer<typeof NodeVisibilitySchema>;

export const CreateNodeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255, 'Name cannot exceed 255 characters'),
  kind: NodeKindSchema,
  parentId: z.string().uuid().nullable().optional(),
  visibility: NodeVisibilitySchema.default('public'),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type CreateNodeInputDto = z.infer<typeof CreateNodeSchema>;

export const UpdateNodeSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  visibility: NodeVisibilitySchema.optional(),
  parentId: z.string().uuid().nullable().optional(),
});
export type UpdateNodeInputDto = z.infer<typeof UpdateNodeSchema>;

export const MoveNodeSchema = z.object({
  newParentId: z.string().uuid().nullable(),
});
export type MoveNodeInputDto = z.infer<typeof MoveNodeSchema>;

export const TreeQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(20).default(5).optional(),
  root: z.string().uuid().optional(),
  includeArchived: z.coerce.boolean().default(false).optional(),
});
export type TreeQueryDto = z.infer<typeof TreeQuerySchema>;

export const ProjectsQuerySchema = z.object({
  teamId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().optional(),
});
export type ProjectsQueryDto = z.infer<typeof ProjectsQuerySchema>;

export const NodeMemberRoleSchema = z.enum(['admin', 'member', 'viewer']);
export type NodeMemberRole = z.infer<typeof NodeMemberRoleSchema>;

export const AddNodeMemberSchema = z.object({
  userId: z.string().uuid(),
  role: NodeMemberRoleSchema.default('member'),
});
export type AddNodeMemberInputDto = z.infer<typeof AddNodeMemberSchema>;
