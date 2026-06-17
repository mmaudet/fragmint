// packages/mcp/src/tools/fragment-search.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { fragmentUrl } from '../url-helpers.js';
import { cache, hashKey, TTL } from '../cache/cache-manager.js';

export const searchDefinition: ToolDefinition = {
  name: 'fragment_search',
  description:
    'Search fragments by semantic similarity and structured filters. Returns ranked results with scores. Results cached locally for 5 minutes.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query text' },
      type: {
        type: 'string',
        description: 'Fragment type filter (introduction, argument, pricing, clause, etc.)',
      },
      lang: { type: 'string', description: 'ISO 639-1 language code filter' },
      quality_min: { type: 'string', description: 'Minimum quality: draft, reviewed, or approved' },
      limit: { type: 'number', description: 'Maximum results to return (default 10)' },
      collection_slugs: {
        oneOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'string', enum: ['all'] },
        ],
        description:
          'Collection slug(s) to search in, or "all" to search everywhere (default: "all"). Use collection_list to discover available collections.',
      },
    },
    required: ['query'],
  },
};

function formatPayloadAsText(payload: string): string {
  try {
    const rows = JSON.parse(payload) as Record<string, string>[];
    if (!Array.isArray(rows) || rows.length === 0) return payload;
    return rows
      .map((row) =>
        Object.entries(row)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => `${k}: ${v}`)
          .join(' | '),
      )
      .filter(Boolean)
      .join('\n');
  } catch {
    return payload;
  }
}

function enrichPayloadExcerpts(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.data)) return result;
  return {
    ...r,
    data: r.data.map((item: unknown) => {
      if (!item || typeof item !== 'object') return item;
      const f = item as Record<string, unknown>;
      if (f.payload && typeof f.payload === 'string') {
        return { ...f, body_excerpt: formatPayloadAsText(f.payload) };
      }
      return f;
    }),
  };
}

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

      const slugs = args.collection_slugs;
      const collectionSlug =
        slugs === 'all' || slugs === undefined ? 'common' : Array.isArray(slugs) ? slugs[0] : slugs;

      const cacheKey = `search:${collectionSlug}:${hashKey({ ...body, collectionSlug })}`;
      const cached = cache.get(cacheKey);
      if (cached) return toolSuccess(JSON.parse(cached));

      const result = await client.post(
        fragmentUrl(collectionSlug as string, '/fragments/search'),
        body,
      );

      // When a fragment has structured payload, replace body_excerpt with
      // formatted row data so the model reads the actual values directly.
      const enriched = enrichPayloadExcerpts(result);

      cache.set(cacheKey, enriched, TTL.SEARCH);
      return toolSuccess(enriched);
    } catch (err) {
      return toolError(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
