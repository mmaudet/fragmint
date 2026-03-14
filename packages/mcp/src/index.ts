#!/usr/bin/env node
// packages/mcp/src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { FragmintApiClient } from './client.js';
import type { ToolDefinition, ToolHandler } from './types.js';

import { inventoryDefinition, inventoryHandler } from './tools/fragment-inventory.js';
import { searchDefinition, searchHandler } from './tools/fragment-search.js';
import { getDefinition, getHandler } from './tools/fragment-get.js';
import { createDefinition, createHandler } from './tools/fragment-create.js';
import { updateDefinition, updateHandler } from './tools/fragment-update.js';
import { lineageDefinition, lineageHandler } from './tools/fragment-lineage.js';

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
  { definition: inventoryDefinition, handler: inventoryHandler(client) },
  { definition: searchDefinition, handler: searchHandler(client) },
  { definition: getDefinition, handler: getHandler(client) },
  { definition: createDefinition, handler: createHandler(client) },
  { definition: updateDefinition, handler: updateHandler(client) },
  { definition: lineageDefinition, handler: lineageHandler(client) },
];

const handlerMap = new Map<string, ToolHandler>(
  tools.map(t => [t.definition.name, t.handler])
);

// MCP Server
const server = new Server(
  { name: 'fragmint', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({
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
  return handler(args ?? {}) as unknown as Record<string, unknown>;
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
