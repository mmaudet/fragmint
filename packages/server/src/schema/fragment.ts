import { z } from 'zod';

export const FRAGMENT_TYPES = [
  'introduction', 'argument', 'pricing', 'clause',
  'faq', 'conclusion', 'bio', 'témoignage',
  'reference-technique', 'methodology', 'engagement', 'cas-usage',
] as const;

export const QUALITY_VALUES = ['draft', 'reviewed', 'approved', 'deprecated'] as const;

// User-initiated transitions only. The approved->reviewed desync is
// handled as a special case in FragmentService, not exposed here.
export const QUALITY_TRANSITIONS: Record<string, string[]> = {
  draft: ['reviewed'],
  reviewed: ['approved'],
  approved: ['deprecated'],
  deprecated: [],
};

export const ROLES = ['reader', 'contributor', 'expert', 'admin'] as const;

export const ROLE_HIERARCHY: Record<string, number> = {
  reader: 0, contributor: 1, expert: 2, admin: 3,
};

export const fragmentFrontmatterSchema = z.object({
  id: z.string().regex(/^frag-[a-f0-9-]+$/),
  type: z.enum(FRAGMENT_TYPES),
  domain: z.string().min(1),
  tags: z.array(z.string()),
  lang: z.string().regex(/^[a-z]{2}$/),
  translation_of: z.string().nullable(),
  translations: z.record(z.string(), z.string().nullable()).optional(),
  quality: z.enum(QUALITY_VALUES),
  author: z.string().min(1),
  reviewed_by: z.string().nullable(),
  approved_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  parent_id: z.string().nullable(),
  generation: z.number().int().min(0),
  uses: z.number().int().default(0),
  last_used: z.string().nullable(),
  contexts: z.array(z.string()).optional(),
  origin: z.enum(['manual', 'harvested', 'generated']).default('manual'),
  origin_source: z.string().nullable().optional(),
  origin_page: z.number().nullable().optional(),
  harvest_confidence: z.number().min(0).max(1).nullable().optional(),
  access: z.object({
    read: z.array(z.string()),
    write: z.array(z.string()),
    approve: z.array(z.string()),
  }),
});

export type FragmentFrontmatter = z.infer<typeof fragmentFrontmatterSchema>;

export const createFragmentSchema = z.object({
  type: z.enum(FRAGMENT_TYPES),
  domain: z.string().min(1),
  tags: z.array(z.string()).default([]),
  lang: z.string().regex(/^[a-z]{2}$/),
  body: z.string().min(1),
  translation_of: z.string().nullable().default(null),
  parent_id: z.string().nullable().default(null),
  generation: z.number().int().min(0).default(0),
  valid_from: z.string().nullable().default(null),
  valid_until: z.string().nullable().default(null),
  origin: z.enum(['manual', 'harvested', 'generated']).default('manual'),
  access: z.object({
    read: z.array(z.string()),
    write: z.array(z.string()),
    approve: z.array(z.string()),
  }).default({ read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] }),
});

export type CreateFragmentInput = z.infer<typeof createFragmentSchema>;

export const updateFragmentSchema = z.object({
  body: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  domain: z.string().min(1).optional(),
  quality: z.enum(QUALITY_VALUES).optional(),
  access: z.object({
    read: z.array(z.string()),
    write: z.array(z.string()),
    approve: z.array(z.string()),
  }).optional(),
});

export type UpdateFragmentInput = z.infer<typeof updateFragmentSchema>;
