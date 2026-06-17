// packages/mcp/src/tools/plan-tools-actions.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

/** Safe error message extraction — handles non-Error throws (strings, plain objects). */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── plan_update ──────────────────────────────────────────────────────────────

export const planUpdateDefinition: ToolDefinition = {
  name: 'plan_update',
  description:
    'Update plan metadata: title, spec_prompt, filters, export_style_template_id. Use to attach a style template (e.g. tpl-lincloud-docx) or refine the brief after creation.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      title: { type: 'string', description: 'New plan title' },
      spec_prompt: { type: 'string', description: 'Updated brief / spec' },
      filters: {
        type: 'object',
        description: 'Fragment filters: { lang?, domain?, type?, tags? }',
      },
      export_style_template_id: {
        type: ['string', 'null'],
        description: 'Style reference template ID to use at export (e.g. tpl_style_cr_linagora). Pass null to remove.',
      },
    },
    required: ['id'],
  },
};

export function planUpdateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_update: id is required');
    const body: Record<string, unknown> = {};
    if (args.title !== undefined) body.title = args.title;
    if (args.spec_prompt !== undefined) body.spec_prompt = args.spec_prompt;
    if (args.filters !== undefined) body.filters = args.filters;
    if (args.export_style_template_id !== undefined) body.export_style_template_id = args.export_style_template_id;
    try {
      const result = await client.patch(`/v1/plans/${id}`, body);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_update failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_assemble ─────────────────────────────────────────────────────────────

export const planAssembleDefinition: ToolDefinition = {
  name: 'plan_assemble',
  description:
    'Assemble the plan draft by concatenating all selected fragments for each section. Returns the updated plan with draft_markdown populated. Run this after selecting fragments, then use plan_export to generate the final document.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
    },
    required: ['id'],
  },
};

export function planAssembleHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_assemble: id is required');
    try {
      const result = await client.post(`/v1/plans/${id}/assemble`, {});
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_assemble failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_add_fragment ─────────────────────────────────────────────────────────

export const planAddFragmentDefinition: ToolDefinition = {
  name: 'plan_add_fragment',
  description:
    'Add a fragment to a plan section\'s candidate list and mark it as selected. Use after plan_section_search to assign a specific fragment to a section.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      section_id: { type: 'string', description: 'Section ID' },
      fragment_id: { type: 'string', description: 'Fragment ID to add' },
    },
    required: ['id', 'section_id', 'fragment_id'],
  },
};

export function planAddFragmentHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    const sectionId = args.section_id as string | undefined;
    const fragmentId = args.fragment_id as string | undefined;
    if (!id) return toolError('plan_add_fragment: id is required');
    if (!sectionId) return toolError('plan_add_fragment: section_id is required');
    if (!fragmentId) return toolError('plan_add_fragment: fragment_id is required');
    try {
      const result = await client.post(`/v1/plans/${id}/sections/${sectionId}/add-fragment`, {
        fragment_id: fragmentId,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_add_fragment failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_add_reference ────────────────────────────────────────────────────────

export const planAddReferenceDefinition: ToolDefinition = {
  name: 'plan_add_reference',
  description:
    'Attach a reference document to a plan. Its content will be used as context in TWO places only:\n1. When generating the plan outline (plan_generate)\n2. When writing each section content (plan_generate_section)\n\nThis does NOT index the document and does NOT add it to the fragment library. It is purely contextual.\n\nfile_path must be a LOCAL file path. If the user gives a URL, use WebFetch to get the content, write it to a temp .md file, then pass that path here.\n\nThe response contains a harvest_prompt field. Display it to the user verbatim as a question and wait for their answer before doing anything else.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      file_path: {
        type: 'string',
        description: 'Absolute path to the reference document (.docx, .md, or .txt)',
      },
    },
    required: ['id', 'file_path'],
  },
};

export function planAddReferenceHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    const filePath = args.file_path as string | undefined;
    if (!id) return toolError('plan_add_reference: id is required');
    if (!filePath) return toolError('plan_add_reference: file_path is required');
    try {
      const { readFileSync } = await import('node:fs');
      const { basename, extname } = await import('node:path');

      const ext = extname(filePath).toLowerCase();
      const name = basename(filePath);

      const HARVEST_QUESTION = '\n\n⚠️ REQUIRED NEXT ACTION: Ask the user this question before doing anything else:\n"Ce document est-il réutilisable pour d\'autres plans ? Si oui, j\'en extrairai des fragments (domaine, langue et tags du plan appliqués automatiquement)."\nWait for the answer. If yes → call plan_harvest_reference after export. If no → continue workflow.';

      if (ext === '.md' || ext === '.txt') {
        const content = readFileSync(filePath, 'utf-8');
        const result = await client.post(`/v1/plans/${id}/add-reference`, { name, content });
        return { content: [{ type: 'text' as const, text: `Document "${name}" added successfully.${HARVEST_QUESTION}` }] };
      } else {
        const form = new FormData();
        form.append('file', new Blob([readFileSync(filePath)]), name);
        await client.postMultipart(`/v1/plans/${id}/add-reference`, form);
        return { content: [{ type: 'text' as const, text: `Document "${name}" added successfully.${HARVEST_QUESTION}` }] };
      }
    } catch (err) {
      return toolError(`plan_add_reference failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_generate_section ─────────────────────────────────────────────────────

export const planGenerateSectionDefinition: ToolDefinition = {
  name: 'plan_generate_section',
  description:
    'Generate the written content for a specific section using the LLM. The LLM uses the selected fragments AND any reference documents attached to the plan as context. ' +
    'Use this instead of plan_assemble when you want the LLM to write each section (not just concatenate fragments). ' +
    'Call for each section after selecting fragments, then call plan_assemble to build the final draft.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      section_id: { type: 'string', description: 'Section ID' },
    },
    required: ['id', 'section_id'],
  },
};

export function planGenerateSectionHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    const sectionId = args.section_id as string | undefined;
    if (!id) return toolError('plan_generate_section: id is required');
    if (!sectionId) return toolError('plan_generate_section: section_id is required');
    try {
      const result = await client.post(`/v1/plans/${id}/sections/${sectionId}/generate`, {});
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_generate_section failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_harvest_reference ────────────────────────────────────────────────────

export const planHarvestReferenceDefinition: ToolDefinition = {
  name: 'plan_harvest_reference',
  description:
    'Extract reusable fragments from the reference documents stored in this plan. ' +
    'Uses stored document content — does NOT read any file from disk.\n\n' +
    'BEFORE calling: ask the user two things in one message:\n' +
    '1. Which collection to add the fragments to (use collection_list to show available options)\n' +
    '2. Confirm or override domain, language, tags\n\n' +
    'Returns job IDs immediately (async). Do NOT spawn subagents, do NOT call fragment_harvest.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      collection_slug: { type: 'string', description: 'Target collection for extracted fragments (e.g. "common", "ira"). Required — ask the user if unknown.' },
      min_confidence: { type: 'number', description: 'Confidence threshold (0.0-1.0, default 0.65)' },
      domain: { type: 'string', description: 'Override domain (e.g. "linto")' },
      lang: { type: 'string', description: 'Override language (e.g. "fr")' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Override tags' },
    },
    required: ['id', 'collection_slug'],
  },
};

export function planHarvestReferenceHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_harvest_reference: id is required');
    try {
      const collection_slug = args.collection_slug as string | undefined;
      if (!collection_slug) return toolError('plan_harvest_reference: collection_slug is required — ask the user which collection to use');
      const body: Record<string, unknown> = {
        min_confidence: (args.min_confidence as number | undefined) ?? 0.65,
        collection_slug,
      };
      if (args.domain) body.domain = args.domain;
      if (args.lang) body.lang = args.lang;
      if (args.tags) body.tags = args.tags;

      const result = await client.post<{ data: { job_ids: string[]; count: number; collection_slug?: string } }>(`/v1/plans/${id}/harvest-reference`, body);
      const jobIds = (result as any)?.data?.job_ids ?? [];
      const collection = (result as any)?.data?.collection_slug ?? 'common';
      return {
        content: [{
          type: 'text' as const,
          text: `Harvest job submitted. ✅ Job IDs: ${jobIds.join(', ')}\nCollection: ${collection}\n\nTell the user: "Extraction is running in collection **${collection}**. Once done, **candidates** will appear in the admin validation UI (http://localhost:5173/ui/harvest). An **administrator** must manually accept/reject them before they become reusable fragments — they are not created automatically."\n\nDo NOT call fragment_harvest. Do NOT spawn subagents. Continue the workflow.`,
        }],
      };
    } catch (err) {
      return toolError(`plan_harvest_reference failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_approve_fragments ────────────────────────────────────────────────────

export const planApproveFragmentsDefinition: ToolDefinition = {
  name: 'plan_approve_fragments',
  description:
    'Move all candidates to selected for each section, with optional per-section exclusions. Call this after the user has reviewed the fragment candidates shown by plan_search_all_sections and approved the selection (possibly asking to remove specific fragments). Required before plan_generate_all_sections.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      exclusions: {
        type: 'array',
        description: 'Optional per-section exclusions',
        items: {
          type: 'object',
          properties: {
            section_id: { type: 'string' },
            exclude_ids: { type: 'array', items: { type: 'string' }, description: 'Fragment IDs to exclude from selection' },
          },
          required: ['section_id', 'exclude_ids'],
        },
      },
    },
    required: ['id'],
  },
};

export function planApproveFragmentsHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_approve_fragments: id is required');
    try {
      await client.post(`/v1/plans/${id}/approve-fragments`, {
        exclusions: (args.exclusions as unknown[]) ?? [],
      });
      return {
        content: [{
          type: 'text' as const,
          text: `Fragment selection confirmed. ✅\n\n⚠️ NEXT STEP: Call plan_generate_all_sections to write the content. This may take a minute.`,
        }],
      };
    } catch (err) {
      return toolError(`plan_approve_fragments failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_section_add_reference ────────────────────────────────────────────────

export const planSectionAddReferenceDefinition: ToolDefinition = {
  name: 'plan_section_add_reference',
  description:
    'Attach a reference document to a specific plan section. Its content will be used as additional context ONLY when generating that section (plan_generate_section), merged with any plan-level reference docs. Supports .docx, .md, .txt.\n\nUse when the user provides a document relevant to one section only (e.g. a technical spec for pricing, a client brief for the intro). For documents relevant to the whole plan, use plan_add_reference instead.\n\nfile_path must be a LOCAL file path. If the user gives a URL, use WebFetch to get the content, write it to a temp .md file, then pass that path here.\n\nThe response contains a harvest_prompt field. Display it to the user verbatim as a question and wait for their answer before doing anything else.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      section_id: { type: 'string', description: 'Section ID' },
      file_path: {
        type: 'string',
        description: 'Absolute path to the reference document (.docx, .md, or .txt)',
      },
    },
    required: ['id', 'section_id', 'file_path'],
  },
};

export function planSectionAddReferenceHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    const sectionId = args.section_id as string | undefined;
    const filePath = args.file_path as string | undefined;
    if (!id) return toolError('plan_section_add_reference: id is required');
    if (!sectionId) return toolError('plan_section_add_reference: section_id is required');
    if (!filePath) return toolError('plan_section_add_reference: file_path is required');
    try {
      const { readFileSync } = await import('node:fs');
      const { basename, extname } = await import('node:path');

      const ext = extname(filePath).toLowerCase();
      const name = basename(filePath);

      const HARVEST_QUESTION = '\n\n⚠️ REQUIRED NEXT ACTION: Ask the user this question before doing anything else:\n"Ce document est-il réutilisable pour d\'autres plans ? Si oui, j\'en extrairai des fragments (domaine, langue et tags du plan appliqués automatiquement)."\nWait for the answer. If yes → call plan_harvest_reference after export. If no → continue workflow.';

      if (ext === '.md' || ext === '.txt') {
        const content = readFileSync(filePath, 'utf-8');
        await client.post(`/v1/plans/${id}/sections/${sectionId}/add-reference`, { name, content });
        return { content: [{ type: 'text' as const, text: `Document "${name}" added to section successfully.${HARVEST_QUESTION}` }] };
      } else {
        const form = new FormData();
        form.append('file', new Blob([readFileSync(filePath)]), name);
        await client.postMultipart(`/v1/plans/${id}/sections/${sectionId}/add-reference`, form);
        return { content: [{ type: 'text' as const, text: `Document "${name}" added to section successfully.${HARVEST_QUESTION}` }] };
      }
    } catch (err) {
      return toolError(`plan_section_add_reference failed: ${errMsg(err)}`);
    }
  };
}

// ── plan_edit_section_fragment ────────────────────────────────────────────────

export const planEditSectionFragmentDefinition: ToolDefinition = {
  name: 'plan_edit_section_fragment',
  description:
    'Edit the text of a fragment already selected in a plan section. The edit is local to this plan — the fragment library is not modified. Sets edited=true on the selection. Use to refine fragment content before assembling the final document.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      section_id: { type: 'string', description: 'Section ID' },
      fragment_id: { type: 'string', description: 'Fragment ID to edit' },
      body: { type: 'string', description: 'New text for the fragment in this section' },
    },
    required: ['id', 'section_id', 'fragment_id', 'body'],
  },
};

export function planEditSectionFragmentHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    const sectionId = args.section_id as string | undefined;
    const fragmentId = args.fragment_id as string | undefined;
    const body = args.body as string | undefined;
    if (!id) return toolError('plan_edit_section_fragment: id is required');
    if (!sectionId) return toolError('plan_edit_section_fragment: section_id is required');
    if (!fragmentId) return toolError('plan_edit_section_fragment: fragment_id is required');
    if (body === undefined) return toolError('plan_edit_section_fragment: body is required');
    try {
      const result = await client.patch(
        `/v1/plans/${id}/sections/${sectionId}/fragment-edit`,
        { fragment_id: fragmentId, body },
      );
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_edit_section_fragment failed: ${errMsg(err)}`);
    }
  };
}
