// packages/mcp/src/tools/fragment-update.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

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
    },
    required: ['id'],
  },
};

export function updateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { id, ...updates } = args;
      // Remove undefined values
      const body = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      const result = await client.put(`/v1/fragments/${id}`, body);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Update fragment failed: ${(err as Error).message}`);
    }
  };
}
