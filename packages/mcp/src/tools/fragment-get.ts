// packages/mcp/src/tools/fragment-get.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { fragmentUrl } from '../url-helpers.js';
import { cache, TTL } from '../cache/cache-manager.js';

export const getDefinition: ToolDefinition = {
  name: 'fragment_get',
  description:
    'Retrieve a complete fragment with its full content and optionally its Git history. Results cached locally for 30 minutes.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Fragment UUID (frag-xxxx-...) or stable readable_id (e.g. LS-ref-003, TM-arg-012). Readable IDs are human-friendly and guaranteed stable — prefer them over UUIDs when referencing fragments by hand.',
      },
      include_history: {
        type: 'boolean',
        description: 'Include Git commit history (default false)',
      },
      collection_slug: {
        type: 'string',
        description:
          'Collection slug (default: "common"). Use collection_list to discover available collections.',
      },
    },
    required: ['id'],
  },
};

export function getHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const slug = args.collection_slug as string | undefined;
      const id = args.id as string;
      const includeHistory = args.include_history === true;
      const cacheKey = `frag:${slug ?? 'common'}:${id}`;

      // Only cache when history is not requested (history changes more often)
      if (!includeHistory) {
        const cached = cache.get(cacheKey);
        if (cached) return toolSuccess(JSON.parse(cached));
      }

      const fragment = await client.get(fragmentUrl(slug, `/fragments/${id}`));
      let history = undefined;
      if (includeHistory) {
        history = await client.get(fragmentUrl(slug, `/fragments/${id}/history`));
      }

      const result = { ...(fragment as Record<string, unknown>), history };

      if (!includeHistory) {
        cache.set(cacheKey, result, TTL.FRAGMENT);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Get fragment failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
