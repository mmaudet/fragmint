// packages/mcp/src/tools/fragment-lineage.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { fragmentUrl } from '../url-helpers.js';
import { cache, TTL } from '../cache/cache-manager.js';

export const lineageDefinition: ToolDefinition = {
  name: 'fragment_lineage',
  description:
    'Get the derivation tree of a fragment — its parent, children (derived fragments), and translations in other languages.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Fragment ID' },
      include_translations: { type: 'boolean', description: 'Include translations (default true)' },
      collection_slug: {
        type: 'string',
        description:
          'Collection slug (default: "common"). Use collection_list to discover available collections.',
      },
    },
    required: ['id'],
  },
};

export function lineageHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const slug = args.collection_slug as string | undefined;
      const id = args.id as string;
      const cacheKey = `lineage:${slug ?? 'common'}:${id}`;

      const cached = cache.get(cacheKey);
      if (cached) return toolSuccess(JSON.parse(cached));

      const result = await client.get(
        fragmentUrl(slug, `/fragments/${id}/lineage`),
      );
      // Add community_cluster (null until Phase 6 Leiden clustering)
      const enriched = { ...(result as Record<string, unknown>), community_cluster: null };
      cache.set(cacheKey, enriched, TTL.LINEAGE);
      return toolSuccess(enriched);
    } catch (err) {
      return toolError(`Lineage failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
