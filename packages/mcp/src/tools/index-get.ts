// packages/mcp/src/tools/index-get.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const getIndexDefinition: ToolDefinition = {
  name: 'get_index',
  description:
    'Retrieve the Fragmint fragment index (table of contents). Returns a structured markdown listing all approved fragments grouped by subject and type. Use this as the first step in any composition workflow to discover available fragments.',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['md', 'json'],
        description:
          'Response format: "md" for human-readable markdown (default), "json" for structured data.',
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
      const refresh = args.refresh ? '&refresh=true' : '';
      const path = `/v1/index?format=${format}${refresh}`;

      if (format === 'json') {
        const data = await client.get(path);
        return toolSuccess(data);
      }

      const markdown = await client.getText(path);
      return { content: [{ type: 'text' as const, text: markdown }] };
    } catch (err) {
      return toolError(`get_index failed: ${(err as Error).message}`);
    }
  };
}
