// packages/mcp/src/tools/fragment-lineage.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const lineageDefinition: ToolDefinition = {
  name: 'fragment_lineage',
  description: 'Get the derivation tree of a fragment — its parent, children (derived fragments), and translations in other languages.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Fragment ID' },
      include_translations: { type: 'boolean', description: 'Include translations (default true)' },
    },
    required: ['id'],
  },
};

export function lineageHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const result = await client.get(`/v1/fragments/${args.id}/lineage`);
      // Add community_cluster (null until Phase 6 Leiden clustering)
      const enriched = { ...(result as Record<string, unknown>), community_cluster: null };
      return toolSuccess(enriched);
    } catch (err) {
      return toolError(`Lineage failed: ${(err as Error).message}`);
    }
  };
}
