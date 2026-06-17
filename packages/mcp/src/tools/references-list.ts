// packages/mcp/src/tools/references-list.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { cache, TTL } from '../cache/cache-manager.js';

export const listSubjectsDefinition: ToolDefinition = {
  name: 'list_subjects',
  description:
    'List all validated subjects (product/domain categories) in the Fragmint referential. Use to understand what subjects are available before composing a document. Cached 1 hour.',
  inputSchema: { type: 'object', properties: {} },
};

export function listSubjectsHandler(client: FragmintApiClient): ToolHandler {
  return async () => {
    try {
      const cached = cache.get('ref:subjects');
      if (cached) return toolSuccess(JSON.parse(cached));

      const data = await client.get('/v1/references/subjects');
      cache.set('ref:subjects', data, TTL.REFERENCES);
      return toolSuccess(data);
    } catch (err) {
      return toolError(`list_subjects failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

export const listEntitiesDefinition: ToolDefinition = {
  name: 'list_entities',
  description:
    'List validated entities (clients, products, technologies, partners, certifications, regulations). Filter by type to narrow results. Cached 1 hour.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: [
          'client',
          'product',
          'technology',
          'partner',
          'certification',
          'regulation',
          'metric',
        ],
        description: 'Filter by entity type (optional).',
      },
    },
  },
};

export function listEntitiesHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const type = args.type as string | undefined;
      const cacheKey = `ref:entities:${type ?? 'all'}`;
      const cached = cache.get(cacheKey);
      if (cached) return toolSuccess(JSON.parse(cached));

      const query = type ? `?type=${encodeURIComponent(type)}` : '';
      const data = await client.get(`/v1/references/entities${query}`);
      cache.set(cacheKey, data, TTL.REFERENCES);
      return toolSuccess(data);
    } catch (err) {
      return toolError(`list_entities failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

export const listTagsDefinition: ToolDefinition = {
  name: 'list_tags',
  description: 'List all validated conceptual tags in the Fragmint referential. Cached 1 hour.',
  inputSchema: { type: 'object', properties: {} },
};

export function listTagsHandler(client: FragmintApiClient): ToolHandler {
  return async () => {
    try {
      const cached = cache.get('ref:tags');
      if (cached) return toolSuccess(JSON.parse(cached));

      const data = await client.get('/v1/references/tags');
      cache.set('ref:tags', data, TTL.REFERENCES);
      return toolSuccess(data);
    } catch (err) {
      return toolError(`list_tags failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
