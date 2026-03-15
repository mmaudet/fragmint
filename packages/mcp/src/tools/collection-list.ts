// packages/mcp/src/tools/collection-list.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const collectionListDefinition: ToolDefinition = {
  name: 'collection_list',
  description:
    'List accessible collections. Call this first to know where to search or create fragments.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export function collectionListHandler(client: FragmintApiClient): ToolHandler {
  return async () => {
    try {
      const result = await client.get('/v1/collections');
      return toolSuccess(result);
    } catch (err) {
      return toolError(`List collections failed: ${(err as Error).message}`);
    }
  };
}
