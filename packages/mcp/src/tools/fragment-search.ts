// packages/mcp/src/tools/fragment-search.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { fragmentUrl } from '../url-helpers.js';

export const searchDefinition: ToolDefinition = {
  name: 'fragment_search',
  description: 'Search fragments by semantic similarity and structured filters. Returns ranked results with scores.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query text' },
      type: { type: 'string', description: 'Fragment type filter (introduction, argument, pricing, clause, etc.)' },
      lang: { type: 'string', description: 'ISO 639-1 language code filter' },
      quality_min: { type: 'string', description: 'Minimum quality: draft, reviewed, or approved' },
      limit: { type: 'number', description: 'Maximum results to return (default 10)' },
      collection_slugs: {
        oneOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'string', enum: ['all'] },
        ],
        description: 'Collection slug(s) to search in, or "all" to search everywhere (default: "all"). Use collection_list to discover available collections.',
      },
    },
    required: ['query'],
  },
};

export function searchHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const body: Record<string, unknown> = {
        query: args.query,
        limit: args.limit ?? 10,
      };
      const filters: Record<string, unknown> = {};
      if (args.type) filters.type = [args.type];
      if (args.lang) filters.lang = args.lang;
      if (args.quality_min) filters.quality_min = args.quality_min;
      if (Object.keys(filters).length > 0) body.filters = filters;

      // Determine collection slug for URL; default to 'common' when not specified
      const slugs = args.collection_slugs;
      const collectionSlug = (slugs === 'all' || slugs === undefined) ? 'common' : (Array.isArray(slugs) ? slugs[0] : slugs);
      const result = await client.post(fragmentUrl(collectionSlug as string, '/fragments/search'), body);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Search failed: ${(err as Error).message}`);
    }
  };
}
