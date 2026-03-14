# Fragmint Phase 2 — MCP Server Design Spec

**Date:** 2026-03-14
**Status:** Approved
**PRD Reference:** Fragmint PRD v0.5 — Phase 2 (MCP server, ~2 semaines)
**Depends on:** Phase 0 (completed), Phase 1 (completed)

## Summary

Phase 2 implements the MCP server for Fragmint — a standalone package (`@fragmint/mcp`) that exposes 6 fragment management tools over the Model Context Protocol. The MCP server is an HTTP client of the Core API (principle P5), distributed as an npm package, compatible with Claude Desktop, Claude Code, OpenCode, and any MCP-compatible client.

`document_compose` (7th tool in PRD) is deferred to Phase 3 when Carbone is integrated.

## Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| MCP SDK | `@modelcontextprotocol/sdk` | Official TypeScript SDK, stdio transport |
| HTTP client | Native `fetch` (Node 24) | Same pattern as CLI package |
| Transport | stdio | Standard for Claude Desktop / Claude Code / OpenCode |
| Package | `@fragmint/mcp` | Standalone npm package per PRD |

## 1. File Structure

```
packages/mcp/
├── src/
│   ├── index.ts              # Entry point — MCP server setup + tool registration
│   ├── client.ts             # HTTP client to Core API
│   ├── tools/
│   │   ├── fragment-inventory.ts
│   │   ├── fragment-search.ts
│   │   ├── fragment-get.ts
│   │   ├── fragment-create.ts
│   │   ├── fragment-update.ts
│   │   └── fragment-lineage.ts
│   └── types.ts              # Shared types (tool params, responses)
├── package.json
├── tsconfig.json
└── README.md
```

One file per MCP tool. Each file exports a function that registers the tool on the MCP server instance.

## 2. Configuration

Via environment variables (per PRD section 11.2):

| Variable | Default | Description |
|---|---|---|
| `FRAGMINT_URL` | `http://localhost:3210` | Core API base URL |
| `FRAGMINT_TOKEN` | (required) | API token or JWT for authentication |

No config file — MCP servers receive env vars from their host (Claude Desktop, Claude Code, etc.).

## 3. HTTP Client

`packages/mcp/src/client.ts` — thin HTTP client, same pattern as `packages/cli/src/client.ts`:

```typescript
class FragmintApiClient {
  constructor(baseUrl: string, token: string)

  async get<T>(path: string): Promise<T>
  async post<T>(path: string, body?: unknown): Promise<T>
  async put<T>(path: string, body: unknown): Promise<T>
}
```

Extracts `data` from the `{ data, meta, error }` response envelope. Throws on error responses with the error message from the API.

## 4. MCP Tools

### 4.1 `fragment_inventory`

**Description for AI agent:** "Diagnose what fragments are available on a topic. Call this BEFORE composing a document to understand coverage, quality distribution, and gaps."

**Parameters:**
```typescript
{ topic?: string, lang?: string }
```

**API call:** `POST /v1/fragments/inventory`

**Returns:** `{ total, by_type, by_quality, by_lang, gaps }`

### 4.2 `fragment_search`

**Description:** "Search fragments by semantic similarity and structured filters. Returns ranked results with scores."

**Parameters:**
```typescript
{ query: string, type?: string, lang?: string, quality_min?: string, limit?: number }
```

**API call:** `POST /v1/fragments/search`

The `type` parameter is passed as `filters.type: [type]` (array) to match the API schema.

**Returns:** `[ { id, title, body_excerpt, score, type, domain, lang, quality } ]`

### 4.3 `fragment_get`

**Description:** "Retrieve a complete fragment with its full content and optionally its Git history."

**Parameters:**
```typescript
{ id: string, include_history?: boolean }
```

**API calls:** `GET /v1/fragments/:id`, optionally + `GET /v1/fragments/:id/history`

**Returns:** `{ id, frontmatter, body, history?: [{ commit, author, date, message }] }`

### 4.4 `fragment_create`

**Description:** "Create and commit a new fragment. The fragment is created with quality 'draft' and must be reviewed and approved by a human."

**Parameters:**
```typescript
{ type: string, domain: string, lang: string, body: string, tags?: string[], parent_id?: string }
```

**API call:** `POST /v1/fragments`

**Returns:** `{ id, commit_hash, quality: "draft" }`

### 4.5 `fragment_update`

**Description:** "Update an existing fragment's content or metadata. Cannot change quality to 'approved' — use the approval workflow."

**Parameters:**
```typescript
{ id: string, body?: string, tags?: string[], domain?: string, quality?: string }
```

**API call:** `PUT /v1/fragments/:id`

**Returns:** `{ id, commit_hash }`

### 4.6 `fragment_lineage`

**Description:** "Get the derivation tree of a fragment — its parent, children (derived fragments), and translations in other languages."

**Parameters:**
```typescript
{ id: string, include_translations?: boolean }
```

**API call:** `GET /v1/fragments/:id/lineage`

By default `include_translations` is true (most useful for agents).

**Returns:** `{ root, children, translations }`

## 5. MCP Server Entry Point

`packages/mcp/src/index.ts`:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({ name: 'fragmint', version: '0.1.0' }, { capabilities: { tools: {} } });

// Register all 6 tools
registerFragmentInventory(server, client);
registerFragmentSearch(server, client);
registerFragmentGet(server, client);
registerFragmentCreate(server, client);
registerFragmentUpdate(server, client);
registerFragmentLineage(server, client);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
```

Each `register*` function calls `server.setRequestHandler` for `tools/list` and `tools/call`.

## 6. Testing

### Unit Tests (`packages/mcp/src/tools/*.test.ts`)

- Mock HTTP client — verify each tool calls the correct endpoint with correct parameters
- Verify response formatting (MCP content text format)
- Verify error handling (API errors surfaced as MCP tool errors)

### End-to-End Tests

**Test with Claude Code:**

Add MCP server config to `.claude/settings.json` in the project:

```json
{
  "mcpServers": {
    "fragmint": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/index.ts"],
      "env": {
        "FRAGMINT_URL": "http://localhost:3210",
        "FRAGMINT_TOKEN": "{{FRAGMINT_TOKEN}}"
      }
    }
  }
}
```

With the Fragmint server running, test by asking Claude Code to use the tools directly (inventory, search, create).

**Test with Claude Desktop:**

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fragmint": {
      "command": "npx",
      "args": ["tsx", "/Users/mmaudet/work/fragmint/packages/mcp/src/index.ts"],
      "env": {
        "FRAGMINT_URL": "http://localhost:3210",
        "FRAGMINT_TOKEN": "frag_tok_xxx"
      }
    }
  }
}
```

Test scenarios for both Claude Code and Claude Desktop:
1. "Fais un inventaire des fragments sur la souveraineté"
2. "Cherche les arguments sur OpenRAG"
3. "Montre-moi le fragment sur le RGPD"
4. "Crée un nouveau fragment d'argument sur LinShare"
5. "Quelle est la lignée du fragment d'introduction souveraineté ?"

## 7. Package Configuration

`packages/mcp/package.json`:

```json
{
  "name": "@fragmint/mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": { "fragmint-mcp": "./dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  },
  "license": "AGPL-3.0-only"
}
```

Executable as `npx @fragmint/mcp` or `fragmint-mcp` when installed globally.

## Out of Scope (Phase 2)

- `document_compose` tool (Phase 3 — requires Carbone)
- `fragment_harvest` tool (Phase 7)
- `fragment_graph_query` tool (Phase 8)
- SSE transport (stdio is sufficient for MVP)
- Authentication via MCP protocol (auth is via FRAGMINT_TOKEN env var)
