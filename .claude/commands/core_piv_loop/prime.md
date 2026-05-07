---
description: Load Fragmint project context — run this at the start of every session
---

# Prime: Load Project Context

Gather and report the current state of the Fragmint codebase so every session starts with full awareness.

## Step 1: Project Structure

```bash
git ls-files | head -100
```

```bash
find packages -type f -name "*.ts" | grep -v node_modules | grep -v dist | sort | head -80
```

## Step 2: Read Core Files

Read these files in order:

1. `CLAUDE.md` — architectural rules and conventions
2. `packages/server/src/config.ts` — all environment defaults
3. `packages/server/src/db/schema.ts` — database schema (fragments, templates, tokens)
4. `packages/server/src/index.ts` — server bootstrap and service wiring

## Step 3: Check External Docs

```bash
ls .claude/external-docs/
```

Read `.claude/external-docs/fragmint-stack.md` if it exists.

## Step 4: Recent Activity

```bash
git log --oneline -15
```

```bash
git status
```

```bash
git diff --stat HEAD~3..HEAD 2>/dev/null | head -30
```

## Step 5: Key Service Inventory

```bash
ls packages/server/src/services/
ls packages/server/src/routes/
ls packages/server/src/schema/
ls packages/server/src/search/
```

## Step 6: Any Existing Plans

```bash
ls .claude/PRPs/plans/ 2>/dev/null
ls .claude/PRPs/plans/completed/ 2>/dev/null
```

## Output Report

Provide a concise structured summary:

```markdown
## Fragmint Session Context

### Git State
- Branch: {branch}
- Status: {clean/dirty — N files modified}
- Last commit: {hash} {message}

### Package Structure
- Server routes: {list}
- Server services: {list}
- Key schema files: {list}

### Recent Changes (last 3 commits)
- {commit summary}

### Active Plans
- {list any .claude/PRPs/plans/*.md files}

### Environment Defaults (from config.ts)
- LLM: {model} at {endpoint}
- Embedding: {model} at {endpoint}
- Milvus: {enabled/disabled}
- Store: {path}

### Ready
Session primed. Key files loaded. What are we working on?
```
