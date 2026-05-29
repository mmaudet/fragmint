# OpenCode + Fragmint Setup

## Prerequisites

- OpenCode installed: `opencode --version` → `1.15.11+`
- Fragmint server running: `docker compose -f docker/docker-compose.dev.yml up`
- MCP server built: `pnpm --filter @fragmint/mcp build`

## Setup

### 1. Generate a Fragmint API token

```bash
curl -s -X POST http://localhost:3210/v1/admin/tokens \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name": "opencode-local", "role": "contributor"}' \
  | jq -r '.data.token'
```

### 2. Export the token in your shell

Add to `~/.zshrc` or `~/.bashrc`:
```bash
export FRAGMINT_TOKEN=frag_tok_<your-token>
```

### 3. Load the Fragmint skill

```bash
mkdir -p ~/.config/opencode/skills/
cp docs/opencode/SKILL.md ~/.config/opencode/skills/fragmint-composer.md
```

### 4. Run OpenCode from the project root

```bash
cd /path/to/fragmint
opencode
```

The `opencode.json` in the project root configures the MCP server automatically.

## Verify It Works

Ask OpenCode:
> "Search for Fragmint fragments about cloud sovereignty"

Expected: OpenCode calls `fragment_search` and returns results.

Ask OpenCode:
> "Create a commercial proposal plan for client ANFSI about Twake Workplace"

Expected: OpenCode calls `plan_create` then `plan_generate` and shows you the section outline.

## Troubleshooting

**"FRAGMINT_TOKEN is required"**: Export the env var before running opencode.

**"HTTP 401"**: Token expired or wrong. Regenerate with the curl command above.

**MCP server not found**: Run `pnpm --filter @fragmint/mcp build` to compile first.

**No tools visible**: Check `opencode.json` is in the current directory when you run opencode.

**`${FRAGMINT_TOKEN}` not expanded**: Some MCP hosts don't support env var substitution. In that case, put the literal token in `opencode.json` and add `opencode.json` to `.gitignore`:
```bash
echo "opencode.json" >> .gitignore
```

## Notes

- `opencode.json` uses `${FRAGMINT_TOKEN}` substitution — the token is NOT stored in the repo.
- The skill file at `docs/opencode/SKILL.md` teaches OpenCode the full Fragmint plan workflow.
- 19 MCP tools are available: fragment CRUD, plan lifecycle, document compose, index/subjects.
