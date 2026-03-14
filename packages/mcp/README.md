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

```json
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
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
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
```

## Getting a Token

Start the Fragmint server in dev mode, then create a token:

```bash
# Start server
npx tsx packages/server/src/index.ts

# Login and get a JWT (dev mode)
curl -s -X POST http://localhost:3210/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mmaudet","password":"fragmint-dev"}'
```

Use the returned JWT as `FRAGMINT_TOKEN`.
