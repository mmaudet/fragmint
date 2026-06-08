// packages/mcp/src/tools/plan-tools.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

/** Safe error message extraction — handles non-Error throws (strings, plain objects). */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── plan_create ──────────────────────────────────────────────────────────────

export const planCreateDefinition: ToolDefinition = {
  name: 'plan_create',
  description:
    'STOP — do NOT call this tool until you have ALL of the following from the user:\n\n' +
    'REQUIRED before calling:\n' +
    '1. Client name or organization (who is this document for?)\n' +
    '2. Language → will set filters.lang (fr or en)\n' +
    '3. Domain or product (e.g. LinShare, Twake Mail, cloud souverain) → will set filters.domain\n' +
    '4. Type of document (proposal, report, presentation…)\n\n' +
    'If ANY of the above is missing from the user message, ask ALL missing items in ONE conversational message BEFORE calling this tool. Do not assume defaults.\n\n' +
    'When explaining this workflow to a user, NEVER use code. Use plain numbered steps in the user language.\n\n' +
    'Once you have all required info: create the plan, then immediately call plan_generate to build the outline. The plan drives: spec → outline → fragment search → assembly → export.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Human-readable plan title (e.g. "Proposition commerciale — IRA")',
      },
      spec_prompt: {
        type: 'string',
        description:
          'Natural-language brief: document type, client name, key topics, constraints. Used by plan_generate to create the outline.',
      },
      filters: {
        type: 'object',
        description:
          'Fragment retrieval filters. lang: "fr"|"en". domain: product/topic area (e.g. "messagerie", "cloud-souverain"). type: fragment type. tags: prefixed tags (e.g. ["produit:Twake Mail"]).',
      },
    },
    required: ['spec_prompt'],
  },
};

export function planCreateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const spec_prompt = args.spec_prompt as string | undefined;
    if (!spec_prompt) return toolError('plan_create: spec_prompt is required');
    try {
      const result = await client.post('/v1/plans', {
        title: args.title as string | undefined,
        spec_prompt,
        filters: (args.filters as object) ?? {},
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_create failed: ${errMsg(err)}`);
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
      return toolError(`plan_list failed: ${errMsg(err)}`);
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
      return toolError(`plan_get failed: ${errMsg(err)}`);
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
    },
    required: ['id'],
  },
};

export function planGenerateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_generate: id is required');
    try {
      const plan = await client.post<{ data: { state: { sections: Array<{ id: string; title: string; description: string }> } } }>(`/v1/plans/${id}/generate-plan`, {});
      const sections = (plan as any)?.data?.state?.sections ?? [];
      const outline = sections.map((s: any, i: number) => `${i + 1}. **${s.title}** — ${s.description}`).join('\n');
      return {
        content: [{
          type: 'text' as const,
          text: `Outline generated for plan ${id}:\n\n${outline}\n\n⚠️ NEXT STEP: Present this outline to the user as a numbered list. Ask: "Does this outline work for you? Any sections to add, remove, or rename?" Do NOT call any other tool until the user approves. Once approved, call plan_validate_outline.`,
        }],
      };
    } catch (err) {
      return toolError(`plan_generate failed: ${errMsg(err)}`);
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
      const body = args.filters_override ? { filters_override: args.filters_override } : {};
      const result = await client.post(`/v1/plans/${id}/sections/${sectionId}/search`, body);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_section_search failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_validate_outline ─────────────────────────────────────────────────────

export const planValidateOutlineDefinition: ToolDefinition = {
  name: 'plan_validate_outline',
  description:
    'Validate the plan outline after the user has approved it. MUST be called after plan_generate and after the user explicitly approves the outline. Unlocks plan_search_all_sections.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
    },
    required: ['id'],
  },
};

export function planValidateOutlineHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_validate_outline: id is required');
    try {
      await client.post(`/v1/plans/${id}/validate-plan`, {});
      return {
        content: [{
          type: 'text' as const,
          text: `Outline validated. ✅\n\n⚠️ NEXT STEP: Call plan_search_all_sections to find relevant fragments for all sections. Then call plan_generate_all_sections to write the content.`,
        }],
      };
    } catch (err) {
      return toolError(`plan_validate_outline failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_search_all_sections ─────────────────────────────────────────────────

export const planSearchAllSectionsDefinition: ToolDefinition = {
  name: 'plan_search_all_sections',
  description:
    'Search fragment candidates for ALL sections of a plan in one call. Use this instead of calling plan_section_search repeatedly. Returns the updated plan with candidates filled for every section.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      top_k: { type: 'number', description: 'Max candidates per section (default: 5)' },
    },
    required: ['id'],
  },
};

export function planSearchAllSectionsHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_search_all_sections: id is required');
    try {
      const body = args.top_k ? { top_k: args.top_k } : {};
      const result = await client.post(`/v1/plans/${id}/search-all-sections`, body);
      const sections = (result as any)?.data?.state?.sections ?? [];
      const summary = sections.map((s: any) => {
        const candidates = s.candidates ?? [];
        if (candidates.length === 0) return `**${s.title}**: no fragments found`;
        const frags = candidates.map((c: any, i: number) => {
          const body = c.body_full ?? c.body_excerpt ?? '(no content)';
          return `  ${i + 1}. [${c.fragment_id?.slice(0, 8)}…] **${c.title ?? '(untitled)'}** (${c.quality}, score: ${c.score != null ? c.score.toFixed(2) : 'n/a'})\n${body.split('\n').map((l: string) => '     ' + l).join('\n')}`;
        }).join('\n\n');
        return `**${s.title}** (${candidates.length} fragment${candidates.length > 1 ? 's' : ''}):\n${frags}`;
      }).join('\n\n---\n\n');
      return {
        content: [{
          type: 'text' as const,
          text: `Fragments found per section (full text included):\n\n${summary}\n\n⚠️ NEXT STEP: Show these fragments to the user with their full text. Ask: "Here are the fragments found for each section. Tell me which ones to remove or replace, or confirm to proceed." Wait for approval, then call plan_approve_fragments.`,
        }],
      };
    } catch (err) {
      return toolError(`plan_search_all_sections failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_generate_all_sections ────────────────────────────────────────────────

export const planGenerateAllSectionsDefinition: ToolDefinition = {
  name: 'plan_generate_all_sections',
  description:
    'Generate written content for ALL prose sections using the LLM, then assemble the draft — all in one call. Use this instead of calling plan_generate_section + plan_assemble separately. The LLM uses selected fragments and any attached reference documents as context. This call is slow (one LLM call per section) — do not cancel it.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
    },
    required: ['id'],
  },
};

export function planGenerateAllSectionsHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_generate_all_sections: id is required');
    try {
      const result = await client.post<{ data: { state: { sections: Array<{ title: string; generated_markdown?: string }> } } }>(`/v1/plans/${id}/generate-all-sections`, {});
      const sections = (result as any)?.data?.state?.sections ?? [];
      const preview = sections
        .map((s: any) => `### ${s.title}\n${s.generated_markdown?.slice(0, 300) ?? '(empty)'}${(s.generated_markdown?.length ?? 0) > 300 ? '…' : ''}`)
        .join('\n\n');
      return {
        content: [{
          type: 'text' as const,
          text: `All sections generated. ✅\n\n${preview}\n\n⚠️ NEXT STEP: Present these sections to the user. Ask: "Please review the sections. Which ones would you like to modify?" Wait for feedback. For each change requested, call plan_generate_section for that section only. Once the user is satisfied, ask which template to use (call template_list), then call plan_export.`,
        }],
      };
    } catch (err) {
      return toolError(`plan_generate_all_sections failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_export ──────────────────────────────────────────────────────────────

export const planExportDefinition: ToolDefinition = {
  name: 'plan_export',
  description:
    'Export a plan as markdown (preview), docx (Word document), or pptx (PowerPoint via Marp). ' +
    'docx and pptx return base64-encoded binary — decode with `base64 -d > output.docx`.\n\n' +
    'BEFORE calling this tool: call template_list to discover available templates, then ask the user which one to use. ' +
    'Use style_template_id for DOCX corporate styling. Use marp_template_id for PPTX slide themes.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      format: {
        type: 'string',
        enum: ['md', 'docx', 'pptx'],
        description: '"md" for Markdown preview, "docx" for Word, "pptx" for PowerPoint',
      },
      style_template_id: {
        type: 'string',
        description: 'Style reference template ID for corporate DOCX styling (kind=style_reference)',
      },
      marp_template_id: {
        type: 'string',
        description: 'Marp template ID for PPTX slide styling (kind=marp)',
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
    if (format !== 'md' && format !== 'docx' && format !== 'pptx')
      return toolError('plan_export: format must be "md", "docx", or "pptx"');
    const styleTemplateId = args.style_template_id as string | undefined;
    const marpTemplateId = args.marp_template_id as string | undefined;
    try {
      if (format === 'md') {
        const content = await client.postText(`/v1/plans/${id}/export`, { format: 'md' });
        return toolSuccess({ format: 'md', content });
      } else if (format === 'pptx') {
        const exportBody = {
          format: 'pptx',
          ...(marpTemplateId && { marp_template_id: marpTemplateId }),
        };
        const content_base64 = await client.postBinary(`/v1/plans/${id}/export`, exportBody);
        return toolSuccess({
          format: 'pptx',
          content_base64,
          note: 'Decode with: echo "<content_base64>" | base64 -d > output.pptx',
        });
      } else {
        const exportBody = {
          format: 'docx',
          ...(styleTemplateId && { style_template_id: styleTemplateId }),
        };
        const content_base64 = await client.postBinary(`/v1/plans/${id}/export`, exportBody);
        return toolSuccess({
          format: 'docx',
          content_base64,
          note: 'Decode with: echo "<content_base64>" | base64 -d > output.docx',
        });
      }
    } catch (err) {
      return toolError(`plan_export (format=${format}) failed: ${errMsg(err)}`);
    }
  };
}
