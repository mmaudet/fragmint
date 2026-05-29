// packages/mcp/src/tools/index-get.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { cache, TTL } from '../cache/cache-manager.js';

export const getIndexDefinition: ToolDefinition = {
  name: 'get_index',
  description:
    'Retrieve the Fragmint fragment index (table of contents). Returns a structured markdown listing all approved fragments grouped by subject and type. Use this as the first step in any composition workflow to discover available fragments. Results are cached locally for 5 minutes.',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['md', 'json'],
        description:
          'Response format: "md" for human-readable markdown (default), "json" for structured data.',
      },
      collection_slug: {
        type: 'string',
        description: 'Collection to index (default: "common").',
      },
      refresh: {
        type: 'boolean',
        description: 'Force cache refresh (default false). Use if index seems stale.',
      },
    },
  },
};

export function getIndexHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const format = (args.format as string | undefined) ?? 'md';
      const slug = (args.collection_slug as string | undefined) ?? 'common';
      const refresh = args.refresh === true;
      const cacheKey = `index:${slug}:${format}`;

      if (!refresh) {
        const cached = cache.get(cacheKey);
        if (cached) {
          return format === 'json'
            ? toolSuccess(JSON.parse(cached))
            : { content: [{ type: 'text' as const, text: cached }] };
        }
      }

      const path = `/v1/index?format=${format}`;

      if (format === 'json') {
        const data = await client.get(path);
        cache.set(cacheKey, data, TTL.INDEX);
        return toolSuccess(data);
      }

      const markdown = await client.getText(path);
      cache.set(cacheKey, markdown, TTL.INDEX);
      return { content: [{ type: 'text' as const, text: markdown }] };
    } catch (err) {
      return toolError(`get_index failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
