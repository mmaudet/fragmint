// packages/mcp/src/tools/fragment-inventory.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { fragmentUrl } from '../url-helpers.js';
import { cache, hashKey, TTL } from '../cache/cache-manager.js';

export const inventoryDefinition: ToolDefinition = {
  name: 'fragment_inventory',
  description:
    'Diagnose what fragments are available on a topic. Call this BEFORE composing a document to understand coverage, quality distribution, and gaps.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Topic or domain to inventory (e.g. "souveraineté", "openrag")',
      },
      lang: { type: 'string', description: 'ISO 639-1 language code filter (e.g. "fr", "en")' },
      collection_slug: {
        type: 'string',
        description:
          'Collection slug (default: "common"). Use collection_list to discover available collections.',
      },
    },
  },
};

export function inventoryHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const slug = args.collection_slug as string | undefined;
      const body = { topic: args.topic, lang: args.lang };
      const cacheKey = `inventory:${slug ?? 'common'}:${hashKey(body)}`;

      const cached = cache.get(cacheKey);
      if (cached) return toolSuccess(JSON.parse(cached));

      const result = await client.post(
        fragmentUrl(slug, '/fragments/inventory'),
        body,
      );
      cache.set(cacheKey, result, TTL.INVENTORY);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Inventory failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
