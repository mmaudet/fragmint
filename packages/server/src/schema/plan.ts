import { z } from 'zod';

export const PLAN_STATUSES = ['draft', 'plan_validated', 'fragments_validated', 'completed'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PlanFiltersSchema = z.object({
  domain: z.string().optional(),
  lang: z.string().optional(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const FragmentCandidateSchema = z.object({
  fragment_id: z.string(),
  score: z.number(),
  title: z.string().nullable(),
  body_excerpt: z.string().nullable(),
  quality: z.string(),
});

export const SectionFragmentSelectionSchema = z.object({
  fragment_id: z.string(),
  body: z.string(),
  edited: z.boolean(),
  propose_to_library: z.boolean(),
  proposed_fragment_id: z.string().optional(),
});

export const PlanSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  candidates: z.array(FragmentCandidateSchema).default([]),
  selected: z.array(SectionFragmentSelectionSchema).default([]),
  generated_markdown: z.string().optional(),
  filters_override: PlanFiltersSchema.optional(),
});

export const PlanStateSchema = z.object({
  spec_prompt: z.string().default(''),
  filters: PlanFiltersSchema.default({}),
  plan_markdown: z.string().default(''),
  writer_prompt_override: z.string().optional(),
  sections: z.array(PlanSectionSchema).default([]),
  draft_markdown: z.string().optional(),
  draft_dirty: z.boolean().optional(),
  export_style_template_id: z.string().optional(),
});

export type PlanState = z.infer<typeof PlanStateSchema>;
export type PlanSection = z.infer<typeof PlanSectionSchema>;
export type PlanFilters = z.infer<typeof PlanFiltersSchema>;
export type SectionFragmentSelection = z.infer<typeof SectionFragmentSelectionSchema>;
export type FragmentCandidate = z.infer<typeof FragmentCandidateSchema>;

export const CreatePlanSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  spec_prompt: z.string().default(''),
  filters: PlanFiltersSchema.default({}),
});

export const UpdatePlanSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  spec_prompt: z.string().optional(),
  filters: PlanFiltersSchema.optional(),
  plan_markdown: z.string().optional(),
  draft_markdown: z.string().optional(),
  draft_dirty: z.boolean().optional(),
  writer_prompt_override: z.string().optional(),
  sections: z.array(PlanSectionSchema).optional(),
  export_style_template_id: z.string().nullable().optional(),
});

export const GeneratePlanSchema = z.object({
  extra_instructions: z.string().optional(),
});

export const SectionSearchSchema = z.object({
  filters_override: PlanFiltersSchema.optional(),
});

export const ExportPlanSchema = z.object({
  format: z.enum(['md', 'docx']),
  style_template_id: z.string().optional(),
});
