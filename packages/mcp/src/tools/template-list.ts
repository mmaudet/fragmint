// packages/mcp/src/tools/template-list.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { cache, TTL } from '../cache/cache-manager.js';

export const templateListDefinition: ToolDefinition = {
  name: 'template_list',
  description:
    'List available templates in Fragmint. Call before plan_export to discover template IDs. ' +
    'Templates are either DOCX style references (use with plan_export format=docx) or Marp slide templates (use with plan_export format=pptx).',
  inputSchema: {
    type: 'object',
    properties: {
      output_format: {
        type: 'string',
        description: 'Filter by output format: "docx" or "pptx". Omit for all.',
      },
    },
    required: [],
  },
};

export function templateListHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { output_format } = args as {
        output_format?: string;
      };

      const cacheKey = `templates::${output_format ?? ''}`;
      const cached = cache.get(cacheKey);
      if (cached) return toolSuccess(JSON.parse(cached));

      const params = new URLSearchParams();
      if (output_format) params.set('output_format', output_format);
      const qs = params.toString();

      const result = await client.get<
        Array<{
          id: string;
          name: string;
          description: string | null;
          output_format: string;
          kind: string;
          version: string;
          author: string;
          created_at: string;
          updated_at: string;
        }>
      >(`/v1/templates${qs ? `?${qs}` : ''}`);

      const payload = {
        count: result.length,
        templates: result.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          output_format: t.output_format,
          version: t.version,
          author: t.author,
          updated_at: t.updated_at,
        })),
      };
      cache.set(cacheKey, payload, TTL.REFERENCES);
      return toolSuccess(payload);
    } catch (err) {
      return toolError(
        `Template list failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
