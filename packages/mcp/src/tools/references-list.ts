// packages/mcp/src/tools/references-list.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const listSubjectsDefinition: ToolDefinition = {
  name: 'list_subjects',
  description:
    'List all validated subjects (product/domain categories) in the Fragmint referential. Use to understand what subjects are available before composing a document.',
  inputSchema: { type: 'object', properties: {} },
};

export function listSubjectsHandler(client: FragmintApiClient): ToolHandler {
  return async () => {
    try {
      const data = await client.get('/v1/references/subjects');
      return toolSuccess(data);
    } catch (err) {
      return toolError(`list_subjects failed: ${(err as Error).message}`);
    }
  };
}

export const listEntitiesDefinition: ToolDefinition = {
  name: 'list_entities',
  description:
    'List validated entities (clients, products, technologies, partners, certifications, regulations). Filter by type to narrow results.',
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
      const type = args.type ? `?type=${encodeURIComponent(args.type as string)}` : '';
      const data = await client.get(`/v1/references/entities${type}`);
      return toolSuccess(data);
    } catch (err) {
      return toolError(`list_entities failed: ${(err as Error).message}`);
    }
  };
}

export const listTagsDefinition: ToolDefinition = {
  name: 'list_tags',
  description: 'List all validated conceptual tags in the Fragmint referential.',
  inputSchema: { type: 'object', properties: {} },
};

export function listTagsHandler(client: FragmintApiClient): ToolHandler {
  return async () => {
    try {
      const data = await client.get('/v1/references/tags');
      return toolSuccess(data);
    } catch (err) {
      return toolError(`list_tags failed: ${(err as Error).message}`);
    }
  };
}
