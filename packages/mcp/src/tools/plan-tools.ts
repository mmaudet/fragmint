// packages/mcp/src/tools/plan-tools.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

// ── plan_create ──────────────────────────────────────────────────────────────

export const planCreateDefinition: ToolDefinition = {
  name: 'plan_create',
  description:
    'Create a new document plan. A plan drives the multi-step composition workflow: spec → outline → section retrieval → export. Returns the plan ID needed for all follow-up operations.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Human-readable plan title (e.g. "Proposition commerciale — ANFSI")',
      },
      spec_prompt: {
        type: 'string',
        description:
          'Natural-language brief describing the document to compose. Used by plan_generate to create the outline.',
      },
      filters: {
        type: 'object',
        description:
          'Optional fragment filters: { lang?: "fr"|"en", domain?: string|string[], type?: string, tags?: string[] }',
      },
    },
  },
};

export function planCreateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { title, spec_prompt, filters } = args;
      const result = await client.post('/v1/plans', {
        title: title as string | undefined,
        spec_prompt: (spec_prompt as string) ?? '',
        filters: (filters as object) ?? {},
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_create failed: ${(err as Error).message}`);
    }
  };
}

// ── plan_list ────────────────────────────────────────────────────────────────

export const planListDefinition: ToolDefinition = {
  name: 'plan_list',
  description:
    'List all plans owned by the authenticated user. Returns id, title, status, and created_at for each plan.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export function planListHandler(client: FragmintApiClient): ToolHandler {
  return async (_args) => {
    try {
      const result = await client.get('/v1/plans');
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_list failed: ${(err as Error).message}`);
    }
  };
}

// ── plan_get ─────────────────────────────────────────────────────────────────

export const planGetDefinition: ToolDefinition = {
  name: 'plan_get',
  description:
    'Get a plan by ID, including full state: spec_prompt, sections with their candidates and selections, generated markdown, and export settings.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Plan ID (returned by plan_create or plan_list)',
      },
    },
    required: ['id'],
  },
};

export function planGetHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_get: id is required');
    try {
      const result = await client.get(`/v1/plans/${id}`);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_get failed: ${(err as Error).message}`);
    }
  };
}

// ── plan_generate ─────────────────────────────────────────────────────────────

export const planGenerateDefinition: ToolDefinition = {
  name: 'plan_generate',
  description:
    'Generate a structured outline (sections) for a plan from its spec_prompt. Updates plan status to plan_generated. Run this after plan_create to get sections you can then populate via plan_section_search.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      extra_instructions: {
        type: 'string',
        description: 'Additional LLM instructions to guide outline generation (optional)',
      },
    },
    required: ['id'],
  },
};

export function planGenerateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_generate: id is required');
    try {
      const result = await client.post(`/v1/plans/${id}/generate-plan`, {
        extra_instructions: args.extra_instructions as string | undefined,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_generate failed: ${(err as Error).message}`);
    }
  };
}

// ── plan_section_search ──────────────────────────────────────────────────────

export const planSectionSearchDefinition: ToolDefinition = {
  name: 'plan_section_search',
  description:
    'Search fragment candidates for a specific section of a plan. The server uses the configured retrieval mode (vector-only, agentic-only, or hybrid) to rank fragments by relevance to the section title and context. Returns an updated plan with candidates filled in for that section.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      section_id: { type: 'string', description: 'Section ID (from plan state.sections[].id)' },
      filters_override: {
        type: 'object',
        description:
          'Optional filter overrides for this section: { domain?: string, lang?: string, type?: string }',
      },
    },
    required: ['id', 'section_id'],
  },
};

export function planSectionSearchHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    const sectionId = args.section_id as string | undefined;
    if (!id) return toolError('plan_section_search: id is required');
    if (!sectionId) return toolError('plan_section_search: section_id is required');
    try {
      const body: Record<string, unknown> = {};
      if (args.filters_override) body.filters_override = args.filters_override;
      const result = await client.post(`/v1/plans/${id}/sections/${sectionId}/search`, body);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_section_search failed: ${(err as Error).message}`);
    }
  };
}

// ── plan_export ──────────────────────────────────────────────────────────────

export const planExportDefinition: ToolDefinition = {
  name: 'plan_export',
  description:
    'Export a plan as markdown (returns text) or docx (returns base64-encoded binary). For docx, decode with `base64 -d > output.docx` or use a base64 decoding tool. Markdown export is useful for previewing; docx is the deliverable.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      format: {
        type: 'string',
        enum: ['md', 'docx'],
        description: '"md" for Markdown text, "docx" for Word document (base64-encoded)',
      },
      style_template_id: {
        type: 'string',
        description: 'Optional style reference template ID to apply corporate styling to docx',
      },
    },
    required: ['id', 'format'],
  },
};

export function planExportHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    const format = args.format as string | undefined;
    if (!id) return toolError('plan_export: id is required');
    if (format !== 'md' && format !== 'docx')
      return toolError('plan_export: format must be "md" or "docx"');
    const styleTemplateId = args.style_template_id as string | undefined;
    try {
      if (format === 'md') {
        const content = await client.postText(`/v1/plans/${id}/export`, {
          format: 'md',
          style_template_id: styleTemplateId,
        });
        return toolSuccess({ format: 'md', content });
      } else {
        const content_base64 = await client.postBinary(`/v1/plans/${id}/export`, {
          format: 'docx',
          style_template_id: styleTemplateId,
        });
        return toolSuccess({
          format: 'docx',
          content_base64,
          note: 'Decode with: echo "<content_base64>" | base64 -d > output.docx',
        });
      }
    } catch (err) {
      return toolError(`plan_export failed: ${(err as Error).message}`);
    }
  };
}
