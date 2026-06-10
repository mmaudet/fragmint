import { z } from 'zod';

export const PlanTemplateSectionSchema = z.object({
  title: z.string(),
  description: z.string(),
  inferred_type: z.string().optional(),
  domain_hint: z.string().optional(),
});

export const PlanTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  status: z.enum(['active', 'draft', 'deprecated']).default('active'),
  tags: z.array(z.string()).default([]),
  sections: z.array(PlanTemplateSectionSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreatePlanTemplateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  status: z.enum(['active', 'draft', 'deprecated']).default('active'),
  tags: z.array(z.string()).optional(),
  sections: z.array(PlanTemplateSectionSchema).min(1),
});

export type PlanTemplate = z.infer<typeof PlanTemplateSchema>;
export type PlanTemplateSection = z.infer<typeof PlanTemplateSectionSchema>;
export type CreatePlanTemplateInput = z.infer<typeof CreatePlanTemplateSchema>;
