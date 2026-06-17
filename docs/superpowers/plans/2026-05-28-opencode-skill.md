# OpenCode Fragmint Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect OpenCode to the Fragmint MCP server and provide a `SKILL.md` that teaches it the complete document composition workflow — from plan creation to docx export — using Fragmint's 19 MCP tools.

**Architecture:** OpenCode reads `opencode.json` from the project root (or `~/.config/opencode/opencode.json` for global config). The MCP server runs as a local subprocess (`node packages/mcp/dist/index.js`). A `SKILL.md` file at the project root (or in `docs/opencode/`) describes Fragmint behavior to the AI. Skills are single Markdown files with YAML frontmatter.

**Tech Stack:** OpenCode 1.15.11 (Go CLI), MCP SDK, Node.js MCP server, SKILL.md (Markdown + YAML frontmatter).

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `opencode.json` (project root) | MCP server config for OpenCode |
| Create | `docs/opencode/SKILL.md` | Fragmint workflow skill for OpenCode |
| Modify | `packages/mcp/src/tools/fragment-get.ts` | Update description to mention readable_id lookup |
| Create | `docs/opencode/README.md` | Setup instructions for new devs |

---

### Task 1: Build the MCP server (prerequisite)

The MCP server must be compiled before OpenCode can spawn it. OpenCode launches it as `node packages/mcp/dist/index.js`.

**Files:**
- No new files

- [ ] **Step 1: Build the MCP package**

```bash
pnpm --filter @fragmint/mcp build
```

Expected: `packages/mcp/dist/index.js` exists, no TypeScript errors.

- [ ] **Step 2: Verify the server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  FRAGMINT_URL=http://localhost:3210 FRAGMINT_TOKEN=test \
  node packages/mcp/dist/index.js 2>/dev/null | head -1
```

Expected: JSON response starting with `{"result":{"tools":[` (or similar MCP JSON-RPC format). The server is working if it doesn't crash immediately.

- [ ] **Step 3: Generate an API token for OpenCode**

```bash
curl -s -X POST http://localhost:3210/v1/admin/tokens \
  -H "Authorization: Bearer $(cat .fragmint-admin-token 2>/dev/null || echo 'ADMIN_TOKEN')" \
  -H "Content-Type: application/json" \
  -d '{"name": "opencode-local", "role": "contributor"}' \
  | jq -r '.data.token'
```

Save the token — you'll use it in the next task as `FRAGMINT_TOKEN`.

---

### Task 2: Create `opencode.json` project configuration

OpenCode reads `opencode.json` from the current working directory. This configures which MCP servers are available.

**Files:**
- Create: `opencode.json` (project root)

- [ ] **Step 1: Check OpenCode's config schema**

```bash
opencode --help 2>&1 | grep -i "config\|json\|mcp" | head -10
# Also check if there's an existing config:
cat ~/.config/opencode/opencode.json 2>/dev/null || echo "No global config"
```

- [ ] **Step 2: Create `opencode.json`**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "claude-sonnet-4-5",
  "mcp": {
    "fragmint": {
      "type": "local",
      "command": "node",
      "args": ["packages/mcp/dist/index.js"],
      "env": {
        "FRAGMINT_URL": "http://localhost:3210",
        "FRAGMINT_TOKEN": "${FRAGMINT_TOKEN}"
      }
    }
  }
}
```

> **Note:** `FRAGMINT_TOKEN` is read from your shell environment. Export it before running opencode:
> ```bash
> export FRAGMINT_TOKEN=frag_tok_<your-token-here>
> opencode
> ```
> Add to `.env.local` or shell profile for persistence.

- [ ] **Step 3: Verify OpenCode loads the MCP tools**

```bash
export FRAGMINT_TOKEN=frag_tok_<your-token>
opencode --print-tools 2>/dev/null || opencode tools 2>/dev/null || \
  echo "Check 'opencode help' for the flag to list available tools"
```

Expected: lists `fragment_search`, `plan_create`, `document_compose`, etc.

If the flag doesn't exist, start opencode interactively and ask: `What tools do you have access to?`

- [ ] **Step 4: Add `opencode.json` to `.gitignore` OR to git (decision)**

`opencode.json` is safe to commit — it uses env var substitution for the token, not a hardcoded secret. Add to git:

```bash
git add opencode.json
git commit -m "feat(opencode): add MCP config for Fragmint"
```

If the team prefers per-developer configs, add to `.gitignore` instead:
```
opencode.json
```

---

### Task 3: Create the Fragmint SKILL.md for OpenCode

A skill is a single Markdown file with YAML frontmatter. OpenCode loads it and uses it as behavioral context when composing responses. The skill teaches Claude how to drive Fragmint's multi-step plan workflow.

**Files:**
- Create: `docs/opencode/SKILL.md`

- [ ] **Step 1: Verify where OpenCode looks for skills**

```bash
opencode help 2>&1 | grep -i "skill\|SKILL" | head -10
ls ~/.config/opencode/skills/ 2>/dev/null || echo "No global skills dir"
ls .opencode/skills/ 2>/dev/null || echo "No project skills dir"
```

OpenCode discovers skills from:
1. `~/.config/opencode/skills/*.md` (global)
2. `.opencode/skills/*.md` (project-local, if supported)
3. A `SKILL.md` in the project root (if supported)

If the exact location is unclear, put it in both `docs/opencode/SKILL.md` (for repo reference) and symlink/copy to wherever OpenCode finds it.

- [ ] **Step 2: Create `docs/opencode/SKILL.md`**

```markdown
---
name: fragmint-composer
description: Use when the user asks to compose, create, search, or export documents using the Fragmint fragment library. Activates MCP tools for the full plan workflow.
---

# Fragmint Document Composer

You have access to the Fragmint fragment library via MCP tools. Use them to drive the complete document composition workflow.

## Core Workflow: Plan → Generate → Search → Export

### 1. Create a plan
```tool
plan_create({
  title: "Proposition commerciale — {client}",
  spec_prompt: "{user's description of the document}",
  filters: { lang: "fr" }
})
```
→ Returns `{ id: "plan-uuid-...", status: "draft" }`

### 2. Generate the outline
```tool
plan_generate({ id: "<plan_id>" })
```
→ Returns the plan with `state.sections[]` filled in (titles + descriptions).
Show the user the section list and ask for approval before proceeding.

### 3. Search fragments for each section
For each section in `state.sections`:
```tool
plan_section_search({ id: "<plan_id>", section_id: "<section.id>" })
```
→ Returns candidates scored by relevance. The top candidates are in `section.candidates`.

### 4. Export the document
```tool
plan_export({ id: "<plan_id>", format: "docx" })
```
→ Returns `{ format: "docx", content_base64: "..." }`.

To save the file:
```bash
echo "<content_base64>" | base64 -d > output.docx
```

## Fragment Search (standalone)

When the user asks for fragments without a full plan:
```tool
fragment_search({
  query: "{user query}",
  lang: "fr",
  type: "argument",
  collection_slug: "common"
})
```

## Discover Available Fragments

Before composing, check what's available:
```tool
get_index({ collection_slug: "common" })
```
→ Returns a structured index: domain → type → fragments with readable IDs (e.g. `TM-arg-001`).

```tool
list_subjects({ collection_slug: "common" })
```
→ Returns all domain:type combinations (useful for filters).

## Fragment Lookup by Readable ID

```tool
fragment_get({ id: "TM-arg-001", collection_slug: "common" })
```
Readable IDs like `TM-arg-001` (prefix-type-number) are stable. UUID lookup also works.

## Key Rules

- **Never hardcode fragment IDs** — always search or use `get_index` to discover them.
- **Always confirm section outline** with the user before running `plan_section_search` on all sections.
- **Filters matter**: `lang: "fr"` is important — don't mix languages unless explicitly asked.
- **Collections**: default is `common`. Use `collection_list` to discover team collections.
- **plan_export docx** returns base64 — always give the user the decode command.
- **Fragments quality**: prefer `approved` > `reviewed` > `draft`. The search service re-ranks by quality automatically.

## Template-Based Composition (alternative to plan workflow)

For quick one-shot composition using a predefined template:
```tool
document_compose({
  template_id: "tpl-proposition-commerciale-001",
  context: { lang: "fr", product: "Twake Workplace", client: "ANFSI" },
  collection_slug: "common"
})
```
→ Returns `{ download_url: "/outputs/...", render_time_ms: N, fragments_resolved: N }`.

Use `collection_list` → template_id from the template list to discover available templates.
```

- [ ] **Step 3: Install the skill where OpenCode finds it**

If OpenCode uses `~/.config/opencode/skills/`:
```bash
mkdir -p ~/.config/opencode/skills/
cp docs/opencode/SKILL.md ~/.config/opencode/skills/fragmint-composer.md
```

If OpenCode uses a project-local `.opencode/skills/`:
```bash
mkdir -p .opencode/skills/
cp docs/opencode/SKILL.md .opencode/skills/fragmint-composer.md
```

Verify the skill loads:
```bash
export FRAGMINT_TOKEN=frag_tok_<your-token>
opencode
# Then ask: "What skills do you have?"
```

Expected: OpenCode mentions `fragmint-composer` or describes the Fragmint workflow.

- [ ] **Step 4: Commit**

```bash
git add docs/opencode/SKILL.md
git commit -m "feat(opencode): add Fragmint composer SKILL.md"
```

---

### Task 4: Create setup documentation

**Files:**
- Create: `docs/opencode/README.md`

- [ ] **Step 1: Create `docs/opencode/README.md`**

```markdown
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

Expected: OpenCode calls `plan_create` then `plan_generate` and shows you the outline.

## Troubleshooting

**"FRAGMINT_TOKEN is required"**: Export the env var before running opencode.

**"HTTP 401"**: Token expired or wrong. Regenerate with the curl command above.

**MCP server not found**: Run `pnpm --filter @fragmint/mcp build` to compile first.

**No tools visible**: Check `opencode.json` is in the current directory when you run opencode.
```

- [ ] **Step 2: Commit**

```bash
git add docs/opencode/README.md
git commit -m "docs(opencode): add setup guide"
```

---

## Self-Review

**Spec coverage:**
- ✅ `opencode.json` with MCP server config (env var token, not hardcoded)
- ✅ `docs/opencode/SKILL.md` covering: plan workflow, fragment search, get_index, template compose
- ✅ Setup README with step-by-step instructions
- ✅ Skill installed to OpenCode's skills directory
- ⚠️ OpenCode skill discovery path not confirmed — Task 3 Step 1 checks it before installing. May need to try both `~/.config/opencode/skills/` and `.opencode/skills/`.
- ⚠️ `opencode.json` `$schema` URL may not be the actual URL — remove if OpenCode complains about unknown fields.
- ⚠️ `FRAGMINT_TOKEN` env var substitution syntax `${FRAGMINT_TOKEN}` — verify OpenCode supports this in `env` values (some MCP hosts don't; if not, the user must put the literal token in the json, which should be in `.gitignore`).
