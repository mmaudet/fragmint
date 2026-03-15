import { z } from 'zod';

export const FragmentSlotSchema = z.object({
  key: z.string(),
  type: z.string(),
  domain: z.string(),
  lang: z.string(),
  quality_min: z.enum(['draft', 'reviewed', 'approved']).default('draft'),
  required: z.boolean().default(true),
  fallback: z.enum(['skip', 'error', 'generate']).default('error'),
  count: z.number().int().positive().default(1),
  collection: z.string().optional(),
  collections: z.array(z.string()).optional(),
});

export const StructuredDataDefSchema = z.object({
  key: z.string(),
  source: z.enum(['context']),
  schema: z.record(z.string()),
});

export const ContextFieldSchema = z.object({
  type: z.enum(['string', 'number', 'date']),
  required: z.boolean().default(false),
  default: z.any().optional(),
  enum: z.array(z.string()).optional(),
});

export const TemplateYamlSchema = z.object({
  id: z.string().startsWith('tpl-'),
  name: z.string(),
  description: z.string().optional(),
  output_format: z.enum(['docx']),
  author: z.string().optional(),
  carbone_template: z.string(),
  version: z.string(),
  fragments: z.array(FragmentSlotSchema),
  structured_data: z.array(StructuredDataDefSchema).optional(),
  context_schema: z.record(ContextFieldSchema).optional(),
  collections: z.array(z.string()).optional(),
});

export type TemplateYaml = z.infer<typeof TemplateYamlSchema>;
export type FragmentSlot = z.infer<typeof FragmentSlotSchema>;

export const ComposeRequestSchema = z.object({
  context: z.record(z.any()),
  overrides: z.record(z.string()).optional(),
  structured_data: z.record(z.any()).optional(),
  output: z.object({
    format: z.enum(['docx']),
    filename: z.string().optional(),
  }).optional(),
});

export type ComposeRequest = z.infer<typeof ComposeRequestSchema>;

export const ResolvedFragmentSchema = z.object({
  key: z.string(),
  fragment_id: z.string(),
  score: z.number(),
  quality: z.string(),
});

export const ComposeResponseSchema = z.object({
  document_url: z.string(),
  expires_at: z.string(),
  template: z.object({ id: z.string(), name: z.string(), version: z.string() }),
  context: z.record(z.any()),
  resolved: z.array(ResolvedFragmentSchema),
  skipped: z.array(z.string()),
  generated: z.array(z.any()),
  structured_data: z.record(z.any()).optional(),
  warnings: z.array(z.string()),
  render_ms: z.number(),
});

export type ComposeResponse = z.infer<typeof ComposeResponseSchema>;
