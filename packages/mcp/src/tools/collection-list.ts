// packages/mcp/src/tools/collection-list.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { cache, TTL } from '../cache/cache-manager.js';

export const collectionListDefinition: ToolDefinition = {
  name: 'collection_list',
  description:
    'List accessible collections. Call this first to know where to search or create fragments. Results cached locally for 1 hour.',
  inputSchema: { type: 'object', properties: {} },
};

export function collectionListHandler(client: FragmintApiClient): ToolHandler {
  return async () => {
    try {
      const cached = cache.get('collections');
      if (cached) return toolSuccess(JSON.parse(cached));

      const result = await client.get('/v1/collections');
      cache.set('collections', result, TTL.COLLECTIONS);
      return toolSuccess(result);
    } catch (err) {
      return toolError(
        `List collections failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
