// packages/mcp/src/tools/document-compose.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const composeDefinition: ToolDefinition = {
  name: 'document_compose',
  description: 'Compose a document from a template with context. Returns composition report with resolved fragments, download URL, and render time.',
  inputSchema: {
    type: 'object',
    properties: {
      template_id: { type: 'string', description: 'Template ID (e.g. "tpl-proposition-commerciale-001")' },
      context: {
        type: 'object',
        description: 'Context variables for composition (e.g. { "lang": "fr", "product": "twake", "client": "Gendarmerie" })',
      },
      overrides: {
        type: 'object',
        description: 'Optional fragment overrides: { slot_key: fragment_id }',
      },
      structured_data: {
        type: 'object',
        description: 'Optional structured data (e.g. { "quantities": { "frag-xxx": 500 } })',
      },
    },
    required: ['template_id', 'context'],
  },
};

export function composeHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { template_id, context, overrides, structured_data } = args;
      const result = await client.post(`/v1/templates/${template_id}/compose`, {
        context,
        overrides: overrides ?? undefined,
        structured_data: structured_data ?? undefined,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Compose failed: ${(err as Error).message}`);
    }
  };
}
