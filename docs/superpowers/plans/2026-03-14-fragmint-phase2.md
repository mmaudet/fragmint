# Fragmint Phase 2 — MCP Server Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Fragmint's 6 fragment management tools via MCP protocol for Claude Desktop, Claude Code, and OpenCode.

**Architecture:** Standalone `@fragmint/mcp` package, HTTP client to Core API, one file per tool, stdio transport via `@modelcontextprotocol/sdk`.

**Tech Stack:** `@modelcontextprotocol/sdk`, native `fetch`, stdio transport

**Spec:** `docs/superpowers/specs/2026-03-14-fragmint-phase2-design.md`

---

## Chunk 1: Package Setup, Client, and Tools

### Task 1: Package setup and HTTP client

**Files:**
- Modify: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/client.ts`
- Create: `packages/mcp/src/types.ts`

- [ ] **Step 1: Update package.json**

Replace `packages/mcp/package.json` with:

```json
{
  "name": "@fragmint/mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": { "fragmint-mcp": "./dist/index.js" },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  },
  "license": "AGPL-3.0-only"
}
```

Create `packages/mcp/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

Run `pnpm install`.

- [ ] **Step 2: Create types.ts**

```typescript
// packages/mcp/src/types.ts

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolHandler {
  (args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function toolSuccess(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export function toolError(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}
```

- [ ] **Step 3: Create client.ts**

```typescript
// packages/mcp/src/client.ts

export class FragmintApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json() as { data: T; meta: unknown; error: string | null };
    if (!res.ok || json.error) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    return json.data;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/
git commit -m "feat(mcp): setup package with HTTP client and types"
```

---

### Task 2: All 6 MCP tools

**Files:**
- Create: `packages/mcp/src/tools/fragment-inventory.ts`
- Create: `packages/mcp/src/tools/fragment-search.ts`
- Create: `packages/mcp/src/tools/fragment-get.ts`
- Create: `packages/mcp/src/tools/fragment-create.ts`
- Create: `packages/mcp/src/tools/fragment-update.ts`
- Create: `packages/mcp/src/tools/fragment-lineage.ts`

- [ ] **Step 1: Create fragment-inventory.ts**

```typescript
// packages/mcp/src/tools/fragment-inventory.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const inventoryDefinition: ToolDefinition = {
  name: 'fragment_inventory',
  description: 'Diagnose what fragments are available on a topic. Call this BEFORE composing a document to understand coverage, quality distribution, and gaps.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic or domain to inventory (e.g. "souveraineté", "openrag")' },
      lang: { type: 'string', description: 'ISO 639-1 language code filter (e.g. "fr", "en")' },
    },
  },
};

export function inventoryHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const result = await client.post('/v1/fragments/inventory', {
        topic: args.topic,
        lang: args.lang,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Inventory failed: ${(err as Error).message}`);
    }
  };
}
```

- [ ] **Step 2: Create fragment-search.ts**

```typescript
// packages/mcp/src/tools/fragment-search.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const searchDefinition: ToolDefinition = {
  name: 'fragment_search',
  description: 'Search fragments by semantic similarity and structured filters. Returns ranked results with scores.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query text' },
      type: { type: 'string', description: 'Fragment type filter (introduction, argument, pricing, clause, etc.)' },
      lang: { type: 'string', description: 'ISO 639-1 language code filter' },
      quality_min: { type: 'string', description: 'Minimum quality: draft, reviewed, or approved' },
      limit: { type: 'number', description: 'Maximum results to return (default 10)' },
    },
    required: ['query'],
  },
};

export function searchHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const body: Record<string, unknown> = {
        query: args.query,
        limit: args.limit ?? 10,
      };
      const filters: Record<string, unknown> = {};
      if (args.type) filters.type = [args.type];
      if (args.lang) filters.lang = args.lang;
      if (args.quality_min) filters.quality_min = args.quality_min;
      if (Object.keys(filters).length > 0) body.filters = filters;

      const result = await client.post('/v1/fragments/search', body);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Search failed: ${(err as Error).message}`);
    }
  };
}
```

- [ ] **Step 3: Create fragment-get.ts**

```typescript
// packages/mcp/src/tools/fragment-get.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const getDefinition: ToolDefinition = {
  name: 'fragment_get',
  description: 'Retrieve a complete fragment with its full content and optionally its Git history.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Fragment ID (e.g. "frag-f1a2b3c4-...")' },
      include_history: { type: 'boolean', description: 'Include Git commit history (default false)' },
    },
    required: ['id'],
  },
};

export function getHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const fragment = await client.get(`/v1/fragments/${args.id}`);
      let history = undefined;
      if (args.include_history) {
        history = await client.get(`/v1/fragments/${args.id}/history`);
      }
      const result = { ...(fragment as Record<string, unknown>), history };
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Get fragment failed: ${(err as Error).message}`);
    }
  };
}
```

- [ ] **Step 4: Create fragment-create.ts**

```typescript
// packages/mcp/src/tools/fragment-create.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

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
    },
    required: ['type', 'domain', 'lang', 'body'],
  },
};

export function createHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const result = await client.post('/v1/fragments', {
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
```

- [ ] **Step 5: Create fragment-update.ts**

```typescript
// packages/mcp/src/tools/fragment-update.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const updateDefinition: ToolDefinition = {
  name: 'fragment_update',
  description: 'Update an existing fragment\'s content or metadata. Cannot change quality to "approved" — use the approval workflow.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Fragment ID to update' },
      body: { type: 'string', description: 'New Markdown content' },
      tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
      domain: { type: 'string', description: 'New domain' },
      quality: { type: 'string', description: 'New quality (draft or reviewed only)' },
    },
    required: ['id'],
  },
};

export function updateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { id, ...updates } = args;
      // Remove undefined values
      const body = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      const result = await client.put(`/v1/fragments/${id}`, body);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`Update fragment failed: ${(err as Error).message}`);
    }
  };
}
```

- [ ] **Step 6: Create fragment-lineage.ts**

```typescript
// packages/mcp/src/tools/fragment-lineage.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const lineageDefinition: ToolDefinition = {
  name: 'fragment_lineage',
  description: 'Get the derivation tree of a fragment — its parent, children (derived fragments), and translations in other languages.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Fragment ID' },
      include_translations: { type: 'boolean', description: 'Include translations (default true)' },
    },
    required: ['id'],
  },
};

export function lineageHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const result = await client.get(`/v1/fragments/${args.id}/lineage`);
      // Add community_cluster (null until Phase 6 Leiden clustering)
      const enriched = { ...(result as Record<string, unknown>), community_cluster: null };
      return toolSuccess(enriched);
    } catch (err) {
      return toolError(`Lineage failed: ${(err as Error).message}`);
    }
  };
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/src/tools/
git commit -m "feat(mcp): add 6 MCP tool handlers (inventory, search, get, create, update, lineage)"
```

---

### Task 3: MCP server entry point

**Files:**
- Create: `packages/mcp/src/index.ts`

- [ ] **Step 1: Create MCP server entry point**

```typescript
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlerMap.get(name);
  if (!handler) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    };
  }
  return handler(args ?? {});
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp/src/index.ts
git commit -m "feat(mcp): add MCP server entry point with stdio transport"
```

---

## Chunk 2: Tests and E2E Configuration

### Task 4: Unit tests

**Files:**
- Create: `packages/mcp/src/tools/tools.test.ts`

- [ ] **Step 1: Write tool tests**

```typescript
// packages/mcp/src/tools/tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { inventoryHandler } from './fragment-inventory.js';
import { searchHandler } from './fragment-search.js';
import { getHandler } from './fragment-get.js';
import { createHandler } from './fragment-create.js';
import { updateHandler } from './fragment-update.js';
import { lineageHandler } from './fragment-lineage.js';

function mockClient() {
  return {
    get: vi.fn().mockResolvedValue({ id: 'frag-test', title: 'Test' }),
    post: vi.fn().mockResolvedValue({ total: 5, by_type: {}, gaps: [] }),
    put: vi.fn().mockResolvedValue({ id: 'frag-test', commit_hash: 'abc123' }),
  };
}

describe('fragment_inventory', () => {
  it('calls POST /v1/fragments/inventory', async () => {
    const client = mockClient();
    const handler = inventoryHandler(client as any);
    const result = await handler({ topic: 'souveraineté' });
    expect(client.post).toHaveBeenCalledWith('/v1/fragments/inventory', { topic: 'souveraineté', lang: undefined });
    expect(result.isError).toBeUndefined();
  });

  it('returns error on API failure', async () => {
    const client = mockClient();
    client.post.mockRejectedValue(new Error('API down'));
    const handler = inventoryHandler(client as any);
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('API down');
  });
});

describe('fragment_search', () => {
  it('calls POST /v1/fragments/search with filters', async () => {
    const client = mockClient();
    client.post.mockResolvedValue([{ id: 'f1', score: 0.9 }]);
    const handler = searchHandler(client as any);
    const result = await handler({ query: 'test', type: 'argument', lang: 'fr' });
    expect(client.post).toHaveBeenCalledWith('/v1/fragments/search', {
      query: 'test', limit: 10,
      filters: { type: ['argument'], lang: 'fr' },
    });
    expect(result.isError).toBeUndefined();
  });
});

describe('fragment_get', () => {
  it('calls GET /v1/fragments/:id', async () => {
    const client = mockClient();
    const handler = getHandler(client as any);
    const result = await handler({ id: 'frag-test' });
    expect(client.get).toHaveBeenCalledWith('/v1/fragments/frag-test');
    expect(result.isError).toBeUndefined();
  });

  it('fetches history when include_history is true', async () => {
    const client = mockClient();
    client.get.mockResolvedValueOnce({ id: 'frag-test' })
              .mockResolvedValueOnce([{ commit: 'abc' }]);
    const handler = getHandler(client as any);
    await handler({ id: 'frag-test', include_history: true });
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(client.get).toHaveBeenCalledWith('/v1/fragments/frag-test/history');
  });
});

describe('fragment_create', () => {
  it('calls POST /v1/fragments', async () => {
    const client = mockClient();
    client.post.mockResolvedValue({ id: 'frag-new', commit_hash: 'abc', quality: 'draft' });
    const handler = createHandler(client as any);
    const result = await handler({ type: 'argument', domain: 'test', lang: 'fr', body: '# Test' });
    expect(client.post).toHaveBeenCalledWith('/v1/fragments', {
      type: 'argument', domain: 'test', lang: 'fr', body: '# Test',
      tags: [], parent_id: null,
    });
    expect(result.isError).toBeUndefined();
  });
});

describe('fragment_update', () => {
  it('calls PUT /v1/fragments/:id', async () => {
    const client = mockClient();
    const handler = updateHandler(client as any);
    const result = await handler({ id: 'frag-test', body: '# Updated' });
    expect(client.put).toHaveBeenCalledWith('/v1/fragments/frag-test', { body: '# Updated' });
    expect(result.isError).toBeUndefined();
  });
});

describe('fragment_lineage', () => {
  it('calls GET /v1/fragments/:id/lineage and adds community_cluster', async () => {
    const client = mockClient();
    client.get.mockResolvedValue({ root: {}, children: [], translations: [] });
    const handler = lineageHandler(client as any);
    const result = await handler({ id: 'frag-test' });
    expect(client.get).toHaveBeenCalledWith('/v1/fragments/frag-test/lineage');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.community_cluster).toBeNull();
  });
});
```

- [ ] **Step 2: Add mcp to vitest workspace**

In `vitest.workspace.ts` at the root, add a new entry:

```typescript
  {
    test: {
      name: 'mcp',
      root: './packages/mcp',
      include: ['src/**/*.test.ts'],
    },
  },
```

- [ ] **Step 3: Run tests — verify they pass**

Run: `pnpm vitest run`
Expected: All tests pass (server tests + new mcp tests)

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/tools/tools.test.ts vitest.workspace.ts
git commit -m "test(mcp): add unit tests for all 6 MCP tools"
```

---

### Task 5: E2E configuration and README

**Files:**
- Create: `packages/mcp/README.md` (replace existing placeholder)

- [ ] **Step 1: Write README with setup instructions**

```markdown
# @fragmint/mcp

MCP server for Fragmint — exposes fragment management tools for Claude Desktop, Claude Code, and OpenCode.

## Tools

| Tool | Description |
|---|---|
| `fragment_inventory` | Diagnose fragment coverage on a topic |
| `fragment_search` | Semantic search with filters |
| `fragment_get` | Get a complete fragment with history |
| `fragment_create` | Create a new fragment (draft) |
| `fragment_update` | Update fragment content or metadata |
| `fragment_lineage` | Get derivation tree and translations |

## Configuration

Requires a running Fragmint server and an API token.

### Claude Code

Add to your project's `.claude/settings.json`:

\`\`\`json
{
  "mcpServers": {
    "fragmint": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/index.ts"],
      "env": {
        "FRAGMINT_URL": "http://localhost:3210",
        "FRAGMINT_TOKEN": "your-token-here"
      }
    }
  }
}
\`\`\`

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

\`\`\`json
{
  "mcpServers": {
    "fragmint": {
      "command": "npx",
      "args": ["tsx", "/path/to/fragmint/packages/mcp/src/index.ts"],
      "env": {
        "FRAGMINT_URL": "http://localhost:3210",
        "FRAGMINT_TOKEN": "your-token-here"
      }
    }
  }
}
\`\`\`

## Getting a Token

Start the Fragmint server in dev mode, then create a token:

\`\`\`bash
# Start server
npx tsx packages/server/src/index.ts

# Login and get a JWT (dev mode)
curl -s -X POST http://localhost:3210/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mmaudet","password":"fragmint-dev"}'
\`\`\`

Use the returned JWT as `FRAGMINT_TOKEN`.
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp/README.md
git commit -m "docs(mcp): add README with Claude Code and Claude Desktop setup instructions"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass (server + mcp)

- [ ] **Step 2: Verify MCP server starts**

```bash
FRAGMINT_TOKEN=test npx tsx packages/mcp/src/index.ts
```

The server should start and wait on stdin (no errors). Ctrl+C to stop.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: Phase 2 MCP server complete"
```
