// packages/mcp/src/tools/fragment-inventory.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const inventoryDefinition: ToolDefinition = {
  name: 'fragment_inventory',
  description: 'Diagnose what fragments are available on a topic. Call this BEFORE composing a document to understand coverage, quality distribution, and gaps.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic or domain to inventory (e.g. "souveraineté", "openrag")' },
      lang: { type: 'string', description: 'ISO 639-1 language code filter (e.g. "fr", "en")' },
    },
  },
};

export function inventoryHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const result = await client.post('/v1/fragments/inventory', {
        topic: args.topic,
        lang: args.lang,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Inventory failed: ${(err as Error).message}`);
    }
  };
}
