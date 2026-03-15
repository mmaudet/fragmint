// packages/mcp/src/tools/fragment-update.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { fragmentUrl } from '../url-helpers.js';

export const updateDefinition: ToolDefinition = {
  name: 'fragment_update',
  description: 'Update an existing fragment\'s content or metadata. Cannot change quality to "approved" — use the approval workflow.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Fragment ID to update' },
      body: { type: 'string', description: 'New Markdown content' },
      tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
      domain: { type: 'string', description: 'New domain' },
      quality: { type: 'string', description: 'New quality (draft or reviewed only)' },
      collection_slug: { type: 'string', description: 'Collection slug (default: "common"). Use collection_list to discover available collections.' },
    },
    required: ['id'],
  },
};

export function updateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { id, collection_slug, ...updates } = args;
      // Remove undefined values
      const body = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      const result = await client.put(fragmentUrl(collection_slug as string | undefined, `/fragments/${id}`), body);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Update fragment failed: ${(err as Error).message}`);
    }
  };
}
