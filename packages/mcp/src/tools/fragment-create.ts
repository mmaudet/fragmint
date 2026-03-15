// packages/mcp/src/tools/fragment-create.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { fragmentUrl } from '../url-helpers.js';

export const createDefinition: ToolDefinition = {
  name: 'fragment_create',
  description: 'Create and commit a new fragment. The fragment is created with quality "draft" and must be reviewed and approved by a human.',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Fragment type: introduction, argument, pricing, clause, faq, conclusion, bio, témoignage' },
      domain: { type: 'string', description: 'Business domain (e.g. "souveraineté", "openrag", "twake")' },
      lang: { type: 'string', description: 'ISO 639-1 language code (e.g. "fr", "en")' },
      body: { type: 'string', description: 'Fragment content in Markdown' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags for classification' },
      parent_id: { type: 'string', description: 'ID of parent fragment if this is a derivation' },
      collection_slug: { type: 'string', description: 'Collection slug (default: "common"). Use collection_list to discover available collections.' },
    },
    required: ['type', 'domain', 'lang', 'body'],
  },
};

export function createHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const result = await client.post(fragmentUrl(args.collection_slug as string | undefined, '/fragments'), {
        type: args.type,
        domain: args.domain,
        lang: args.lang,
        body: args.body,
        tags: args.tags ?? [],
        parent_id: args.parent_id ?? null,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Create fragment failed: ${(err as Error).message}`);
    }
  };
}
