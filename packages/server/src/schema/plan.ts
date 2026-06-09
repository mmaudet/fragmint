import { z } from 'zod';

export const PLAN_STATUSES = [
  'draft',
  'plan_generated',
  'plan_validated',
  'fragments_validated',
  'completed',
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PlanFiltersSchema = z.object({
  domain: z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(z.string()).optional()),
  lang: z.string().optional(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const ScoreBreakdownSchema = z.object({
  method: z.enum(['vector', 'agentic', 'hybrid_rrf', 'sqlite_like', 'tag_match']),
  vector_score: z.number().optional(),
  vector_rank: z.number().optional(),
  llm_score: z.number().optional(),
  llm_rank: z.number().optional(),
  rrf_score: z.number().optional(),
  rrf_k: z.number().optional(),
  final_score: z.number().optional(),
});

export const FragmentCandidateSchema = z.object({
  fragment_id: z.string(),
  score: z.number().nullable(),
  title: z.string().nullable(),
  body_excerpt: z.string().nullable(),
  body_full: z.string().nullable().optional(),
  quality: z.string(),
  type: z.string().optional(),
  payload_schema: z.string().nullable().optional(),
  score_breakdown: ScoreBreakdownSchema.optional(),
  justification: z.string().optional(),
  retrieval_source: z.enum(['vector', 'tag', 'both']).optional(),
  /** LLM judge confidence: high (llm≥9) / medium (7-8) / low (≤6) / unknown (no LLM score). */
  confidence_level: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
});

export const SectionFragmentSelectionSchema = z.object({
  fragment_id: z.string(),
  body: z.string(),
  edited: z.boolean(),
  propose_to_library: z.boolean(),
  proposed_fragment_id: z.string().optional(),
});

export const GroundednessFlagSchema = z.object({
  text: z.string(),
  risk: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
});
export type GroundednessFlag = z.infer<typeof GroundednessFlagSchema>;

export const PlanSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  candidates: z.array(FragmentCandidateSchema).default([]),
  selected: z.array(SectionFragmentSelectionSchema).default([]),
  generated_markdown: z.string().optional(),
  groundedness_flags: z.array(GroundednessFlagSchema).optional(),
  filters_override: PlanFiltersSchema.optional(),
  inferred_type: z.string().optional(),
  writer_instructions: z.string().optional(),
  /** Section-level retrieval quality: good (top llm≥9) / partial (top llm 7-8) / poor (top llm≤6) / empty (no candidates). */
  section_confidence: z.enum(['good', 'partial', 'poor', 'empty']).optional(),
  reference_docs: z.array(z.object({ name: z.string(), content: z.string() })).optional(),
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
  reference_docs: z.array(z.object({ name: z.string(), content: z.string() })).default([]),
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
  reference_docs: z.array(z.object({ name: z.string(), content: z.string() })).optional(),
});

export const GeneratePlanSchema = z.object({});

export const SectionSearchSchema = z.object({
  filters_override: PlanFiltersSchema.optional(),
  top_k: z.coerce.number().int().min(1).max(20).optional(),
});

export const ExportPlanSchema = z.object({
  format: z.enum(['md', 'docx', 'pptx', 'slides', 'reveal']),
  style_template_id: z.string().optional(),
  // kept for legacy compatibility — no longer exposed in UI
  marp_theme: z.enum(['default', 'gaia', 'uncover', 'linagora']).optional(),
  reveal_theme: z.enum(['white', 'black', 'moon', 'sky', 'beige', 'simple', 'solarized', 'linagora']).optional(),
});

export const AddFragmentToSectionSchema = z
  .object({
    fragment_id: z.string().min(1).optional(),
    manual: z
      .object({
        body: z.string().min(1),
        type: z.string().optional(),
        lang: z
          .string()
          .regex(/^[a-z]{2}$/)
          .default('fr'),
        domain: z.string().min(1).default('other'),
        propose_to_library: z.boolean().default(false),
      })
      .optional(),
  })
  .refine((v) => !!v.fragment_id !== !!v.manual, {
    message: 'Provide exactly one of fragment_id or manual',
  });
