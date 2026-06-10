#!/usr/bin/env node
// packages/mcp/src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { FragmintApiClient } from './client.js';
import type { ToolDefinition, ToolHandler } from './types.js';

import { inventoryDefinition, inventoryHandler } from './tools/fragment-inventory.js';
import { searchDefinition, searchHandler } from './tools/fragment-search.js';
import { getDefinition, getHandler } from './tools/fragment-get.js';
import { createDefinition, createHandler } from './tools/fragment-create.js';
import { updateDefinition, updateHandler } from './tools/fragment-update.js';
import { lineageDefinition, lineageHandler } from './tools/fragment-lineage.js';
import { composeDefinition, composeHandler } from './tools/document-compose.js';
import { harvestDefinition, harvestHandler } from './tools/fragment-harvest.js';
import { collectionListDefinition, collectionListHandler } from './tools/collection-list.js';
import { getIndexDefinition, getIndexHandler } from './tools/index-get.js';
import {
  listSubjectsDefinition,
  listSubjectsHandler,
  listEntitiesDefinition,
  listEntitiesHandler,
  listTagsDefinition,
  listTagsHandler,
} from './tools/references-list.js';
import {
  planCreateDefinition,
  planCreateHandler,
  planListDefinition,
  planListHandler,
  planGetDefinition,
  planGetHandler,
  planGenerateDefinition,
  planGenerateHandler,
  planSectionSearchDefinition,
  planSectionSearchHandler,
  planValidateOutlineDefinition,
  planValidateOutlineHandler,
  planSearchAllSectionsDefinition,
  planSearchAllSectionsHandler,
  planStartSearchDefinition,
  planStartSearchHandler,
  planCheckSearchDefinition,
  planCheckSearchHandler,
  planGenerateAllSectionsDefinition,
  planGenerateAllSectionsHandler,
  planExportDefinition,
  planExportHandler,
} from './tools/plan-tools.js';
import {
  planUpdateDefinition,
  planUpdateHandler,
  planAssembleDefinition,
  planAssembleHandler,
  planAddFragmentDefinition,
  planAddFragmentHandler,
  planAddReferenceDefinition,
  planAddReferenceHandler,
  planEditSectionFragmentDefinition,
  planEditSectionFragmentHandler,
  planGenerateSectionDefinition,
  planGenerateSectionHandler,
  planHarvestReferenceDefinition,
  planHarvestReferenceHandler,
  planApproveFragmentsDefinition,
  planApproveFragmentsHandler,
  planSectionAddReferenceDefinition,
  planSectionAddReferenceHandler,
} from './tools/plan-tools-actions.js';
import {
  cacheStatusDefinition,
  cacheStatusHandler,
  cacheSyncDefinition,
  cacheSyncHandler,
  cacheClearDefinition,
  cacheClearHandler,
} from './tools/cache-tools.js';
import { templateUploadDefinition, templateUploadHandler } from './tools/template-upload.js';
import { templateListDefinition, templateListHandler } from './tools/template-list.js';
import {
  retrievalModeGetDefinition,
  retrievalModeGetHandler,
  retrievalModeSetDefinition,
  retrievalModeSetHandler,
} from './tools/retrieval-mode.js';
import {
  listCollectionsDefinition,
  listCollectionsHandler,
  getCollectionMembersDefinition,
  getCollectionMembersHandler,
  searchFragmentsByPayloadDefinition,
  searchFragmentsByPayloadHandler,
  composeTableSlotDefinition,
  composeTableSlotHandler,
} from './tools/collection-tools.js';

// Configuration from environment
const FRAGMINT_URL = process.env.FRAGMINT_URL ?? 'http://localhost:3210';
const FRAGMINT_TOKEN = process.env.FRAGMINT_TOKEN;

if (!FRAGMINT_TOKEN) {
  console.error('FRAGMINT_TOKEN environment variable is required');
  process.exit(1);
}

const client = new FragmintApiClient(FRAGMINT_URL, FRAGMINT_TOKEN);

// Tool registry
const tools: Array<{ definition: ToolDefinition; handler: ToolHandler }> = [
  { definition: collectionListDefinition, handler: collectionListHandler(client) },
  { definition: inventoryDefinition, handler: inventoryHandler(client) },
  { definition: searchDefinition, handler: searchHandler(client) },
  { definition: getDefinition, handler: getHandler(client) },
  { definition: createDefinition, handler: createHandler(client) },
  { definition: updateDefinition, handler: updateHandler(client) },
  { definition: lineageDefinition, handler: lineageHandler(client) },
  { definition: composeDefinition, handler: composeHandler(client) },
  { definition: harvestDefinition, handler: harvestHandler(client) },
  { definition: getIndexDefinition, handler: getIndexHandler(client) },
  { definition: listSubjectsDefinition, handler: listSubjectsHandler(client) },
  { definition: listEntitiesDefinition, handler: listEntitiesHandler(client) },
  { definition: listTagsDefinition, handler: listTagsHandler(client) },
  { definition: planCreateDefinition, handler: planCreateHandler(client) },
  { definition: planListDefinition, handler: planListHandler(client) },
  { definition: planGetDefinition, handler: planGetHandler(client) },
  { definition: planGenerateDefinition, handler: planGenerateHandler(client) },
  { definition: planUpdateDefinition, handler: planUpdateHandler(client) },
  { definition: planAssembleDefinition, handler: planAssembleHandler(client) },
  { definition: planSectionSearchDefinition, handler: planSectionSearchHandler(client) },
  { definition: planValidateOutlineDefinition, handler: planValidateOutlineHandler(client) },
  { definition: planSearchAllSectionsDefinition, handler: planSearchAllSectionsHandler(client) },
  { definition: planStartSearchDefinition, handler: planStartSearchHandler(client) },
  { definition: planCheckSearchDefinition, handler: planCheckSearchHandler(client) },
  { definition: planGenerateAllSectionsDefinition, handler: planGenerateAllSectionsHandler(client) },
  { definition: planAddFragmentDefinition, handler: planAddFragmentHandler(client) },
  { definition: planAddReferenceDefinition, handler: planAddReferenceHandler(client) },
  { definition: planEditSectionFragmentDefinition, handler: planEditSectionFragmentHandler(client) },
  { definition: planGenerateSectionDefinition, handler: planGenerateSectionHandler(client) },
  { definition: planHarvestReferenceDefinition, handler: planHarvestReferenceHandler(client) },
  { definition: planApproveFragmentsDefinition, handler: planApproveFragmentsHandler(client) },
  { definition: planSectionAddReferenceDefinition, handler: planSectionAddReferenceHandler(client) },
  { definition: planExportDefinition, handler: planExportHandler(client) },
  { definition: cacheStatusDefinition, handler: cacheStatusHandler(client) },
  { definition: cacheSyncDefinition, handler: cacheSyncHandler(client) },
  { definition: cacheClearDefinition, handler: cacheClearHandler(client) },
  { definition: templateUploadDefinition, handler: templateUploadHandler(client) },
  { definition: templateListDefinition, handler: templateListHandler(client) },
  { definition: retrievalModeGetDefinition, handler: retrievalModeGetHandler(client) },
  { definition: retrievalModeSetDefinition, handler: retrievalModeSetHandler(client) },
  { definition: listCollectionsDefinition, handler: listCollectionsHandler(client) },
  { definition: getCollectionMembersDefinition, handler: getCollectionMembersHandler(client) },
  { definition: searchFragmentsByPayloadDefinition, handler: searchFragmentsByPayloadHandler(client) },
  { definition: composeTableSlotDefinition, handler: composeTableSlotHandler(client) },
];

const handlerMap = new Map<string, ToolHandler>(tools.map((t) => [t.definition.name, t.handler]));

// MCP Server
const server = new Server({ name: 'fragmint', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.definition.name,
    description: t.definition.description,
    inputSchema: t.definition.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
  const { name, arguments: args } = request.params;
  const handler = handlerMap.get(name);
  if (!handler) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    } as Record<string, unknown>;
  }
  try {
    return handler(args ?? {}) as unknown as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mcp] Unhandled exception in tool "${name}":`, err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Tool "${name}" crashed: ${msg}` }],
    } as Record<string, unknown>;
  }
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
