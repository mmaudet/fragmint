// packages/mcp/src/tools/fragment-get.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { fragmentUrl } from '../url-helpers.js';

export const getDefinition: ToolDefinition = {
  name: 'fragment_get',
  description: 'Retrieve a complete fragment with its full content and optionally its Git history.',
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
      const fragment = await client.get(fragmentUrl(slug, `/fragments/${args.id}`));
      let history = undefined;
      if (args.include_history) {
        history = await client.get(fragmentUrl(slug, `/fragments/${args.id}/history`));
      }
      const result = { ...(fragment as Record<string, unknown>), history };
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Get fragment failed: ${(err as Error).message}`);
    }
  };
}
