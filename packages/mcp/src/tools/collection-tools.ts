// packages/mcp/src/tools/collection-tools.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { cache, TTL } from '../cache/cache-manager.js';

// ---------------------------------------------------------------------------
// 1. list_collections
// ---------------------------------------------------------------------------

export const listCollectionsDefinition: ToolDefinition = {
  name: 'list_collections',
  description:
    'List fragment collections (table groups). Use to find a collection to use as table source in a plan section.',
  inputSchema: {
    type: 'object',
    properties: {
      collection_slug: {
        type: 'string',
        description: 'Filter by vault collection slug (e.g. "common"). Omit for all.',
      },
    },
    required: [],
  },
};

export function listCollectionsHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { collection_slug } = args as { collection_slug?: string };

      const cacheKey = `fragment-collections:${collection_slug ?? ''}`;
      const cached = cache.get(cacheKey);
      if (cached) return toolSuccess(JSON.parse(cached));

      const params = new URLSearchParams();
      if (collection_slug) params.set('collection_slug', collection_slug);
      const qs = params.toString();

      const result = await client.get<{ data: unknown[]; meta: { count: number }; error: null }>(
        `/v1/fragment-collections${qs ? `?${qs}` : ''}`,
      );

      const payload = {
        count: result.meta?.count ?? (Array.isArray(result.data) ? result.data.length : 0),
        collections: result.data,
      };
      cache.set(cacheKey, payload, TTL.REFERENCES);
      return toolSuccess(payload);
    } catch (err) {
      return toolError(
        `list_collections failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// 2. get_collection_members
// ---------------------------------------------------------------------------

export const getCollectionMembersDefinition: ToolDefinition = {
  name: 'get_collection_members',
  description:
    'Get a fragment collection with all its member fragments and their payload data.',
  inputSchema: {
    type: 'object',
    properties: {
      collection_id: {
        type: 'string',
        description: 'Fragment collection ID (e.g. "fc_<uuid>").',
      },
    },
    required: ['collection_id'],
  },
};

export function getCollectionMembersHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { collection_id } = args as { collection_id: string };

      const collResult = await client.get<{
        data: {
          id: string;
          title: string;
          description: string | null;
          payload_schema: string | null;
          member_ids: string[];
          source_document: string | null;
          collection_slug: string | null;
          created_at: string;
          created_by: string;
          updated_at: string;
        };
        meta: null;
        error: null;
      }>(`/v1/fragment-collections/${collection_id}`);

      const collection = collResult.data;
      const memberIds: string[] = Array.isArray(collection.member_ids) ? collection.member_ids : [];

      const members = await Promise.all(
        memberIds.map(async (fragmentId) => {
          try {
            const fragResult = await client.get<{ data: unknown; meta: null; error: null }>(
              `/v1/fragments/${fragmentId}`,
            );
            return fragResult.data ?? fragResult;
          } catch {
            return { id: fragmentId, error: 'not_found' };
          }
        }),
      );

      return toolSuccess({ collection, members });
    } catch (err) {
      return toolError(
        `get_collection_members failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// 3. search_fragments_by_payload
// ---------------------------------------------------------------------------

export const searchFragmentsByPayloadDefinition: ToolDefinition = {
  name: 'search_fragments_by_payload',
  description:
    'Search fragments that have structured payload data, filtering by schema (e.g. "sla-row-v1", "pricing-line-v1").',
  inputSchema: {
    type: 'object',
    properties: {
      payload_schema: {
        type: 'string',
        description:
          'Payload schema ID to filter by (e.g. "sla-row-v1", "pricing-line-v1", "reference-v1", "generic-row-v1").',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default 50).',
      },
    },
    required: ['payload_schema'],
  },
};

export function searchFragmentsByPayloadHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { payload_schema, limit } = args as {
        payload_schema: string;
        limit?: number;
      };

      const params = new URLSearchParams();
      params.set('payload_schema', payload_schema);
      if (limit != null) params.set('limit', String(limit));

      const result = await client.get<{
        data: unknown[];
        meta: { count: number; total: number };
        error: null;
      }>(`/v1/fragments?${params.toString()}`);

      return toolSuccess({
        payload_schema,
        count: result.meta?.count ?? (Array.isArray(result.data) ? result.data.length : 0),
        total: result.meta?.total,
        fragments: result.data,
      });
    } catch (err) {
      return toolError(
        `search_fragments_by_payload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// 4. compose_table_slot
// ---------------------------------------------------------------------------

export const composeTableSlotDefinition: ToolDefinition = {
  name: 'compose_table_slot',
  description:
    'Build a table_source object ready to use in a plan section. Returns { render_mode: "table", table_source: {...}, columns: [...] }.',
  inputSchema: {
    type: 'object',
    properties: {
      collection_id: {
        type: 'string',
        description: 'Fragment collection ID to use as the table source.',
      },
      fragment_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Explicit list of fragment IDs to include (alternative to collection_id).',
      },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Ordered list of payload field names to render as columns (e.g. ["niveau", "prise_en_charge", "resolution"]).',
      },
      order_by: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Payload field name to sort by.' },
          direction: {
            type: 'string',
            enum: ['asc', 'desc'],
            description: 'Sort direction.',
          },
        },
        required: ['field', 'direction'],
        description: 'Optional sort configuration.',
      },
    },
    required: ['columns'],
  },
};

export function composeTableSlotHandler(_client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const {
        collection_id,
        fragment_ids,
        columns,
        order_by,
      } = args as {
        collection_id?: string;
        fragment_ids?: string[];
        columns: string[];
        order_by?: { field: string; direction: 'asc' | 'desc' };
      };

      if (!columns || columns.length === 0) {
        return toolError('compose_table_slot: columns must be a non-empty array.');
      }

      const tableSource: Record<string, unknown> = {};
      if (collection_id) tableSource.collection_id = collection_id;
      if (fragment_ids && fragment_ids.length > 0) tableSource.fragment_ids = fragment_ids;
      if (order_by) tableSource.order_by = order_by;

      return toolSuccess({
        render_mode: 'table',
        table_source: tableSource,
        columns,
      });
    } catch (err) {
      return toolError(
        `compose_table_slot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
