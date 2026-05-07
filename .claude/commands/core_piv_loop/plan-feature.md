---
description: Create a comprehensive implementation plan for a Fragmint feature
argument-hint: <feature description>
---

# Plan a Fragmint Feature

## Feature: $ARGUMENTS

## Mission

Transform a feature request into a comprehensive implementation plan through systematic codebase analysis and strategic design.

**Core Principle**: Do NOT write code in this phase. Create a context-rich plan that enables one-pass implementation success.

**Output**: `.claude/PRPs/plans/{kebab-case-name}.plan.md` (500–700 lines)

---

## Phase 1: Feature Understanding

- Extract the core problem being solved
- Determine feature type: New Route / New Service / UI Component / MCP Tool / Bugfix / Refactor
- Assess complexity: Low / Medium / High
- Identify affected packages: server / web / mcp / cli

**User Story**:
```
As a <role>
I want to <action>
So that <benefit>
```

---

## Phase 2: Codebase Analysis

Run these explorations (use parallel subagents when beneficial):

### 2a. Existing Patterns

Find similar implementations to mirror:

```bash
# Similar routes
ls packages/server/src/routes/
grep -r "app.get\|app.post\|app.patch\|app.delete" packages/server/src/routes/ | head -20

# Similar services
ls packages/server/src/services/

# Similar Zod schemas
ls packages/server/src/schema/

# Similar Drizzle queries
grep -r "db.select\|db.insert\|db.update\|db.delete" packages/server/src/ | head -20
```

### 2b. DB Schema

Always read:
```bash
cat packages/server/src/db/schema.ts
```

### 2c. Config & Wiring

```bash
cat packages/server/src/config.ts
cat packages/server/src/index.ts
```

### 2d. Tests Structure

```bash
find packages -name "*.test.ts" | head -20
```

### 2e. Web Components (if UI involved)

```bash
ls packages/web/src/components/
```

---

## Phase 3: External Research

For new AI/Milvus/docx patterns, check:
- `.claude/external-docs/fragmint-stack.md` — Fragmint stack reference
- Official docs if adding a new dependency (verify actual API before planning)

---

## Phase 4: Strategic Design

Think through:
- Which package(s) are affected?
- Does this need a new Zod schema? New Drizzle table/column?
- Does this need a new Milvus partition or just SQLite?
- Does the frontend need a new component or just a new API call?
- What are the auth requirements? (which roles can access this?)
- What are the edge cases? (missing Milvus, Ollama down, invalid fragment, etc.)

---

## Phase 5: Generate Plan

Create `.claude/PRPs/plans/{name}.plan.md` with this structure:

```markdown
# Plan: {feature-name}

> Read and understand this plan fully before implementing. Validate patterns against current codebase before coding.

## Feature Description
{What it does, why it matters}

## User Story
As a {role}
I want to {action}
So that {benefit}

## Affected Packages
- [ ] packages/server
- [ ] packages/web
- [ ] packages/mcp
- [ ] packages/cli

## Complexity: {Low/Medium/High}

---

## CONTEXT REFERENCES

### Files to Read Before Implementing

- `packages/server/src/routes/fragments.ts` — mirror route registration pattern
- `packages/server/src/services/fragment-service.ts` — mirror service pattern
- `packages/server/src/schema/fragment.ts` — mirror Zod schema pattern
- `packages/server/src/db/schema.ts` — full DB schema
- {any other relevant files with line numbers}

### New Files to Create

- `packages/server/src/routes/xxx.ts` — new route
- `packages/server/src/services/xxx-service.ts` — new service
- `packages/server/src/schema/xxx.ts` — Zod schemas

### Patterns to Follow

**Route registration** (mirror from `packages/server/src/index.ts`):
```typescript
app.register(xxxRoutes);
```

**Zod schema**:
```typescript
export const ListXxxSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

{Other specific patterns extracted from the codebase}

---

## IMPLEMENTATION PLAN

### Phase 1: Schema (Zod + DB)
- Define Zod input/output schemas in `schema/`
- Add Drizzle table/column if needed (and migration)

### Phase 2: Service
- Implement service class with explicit constructor deps
- Write unit tests

### Phase 3: Route
- Register Fastify route with Zod schema
- Apply auth hook if needed
- Wire service via `req.server.xxxService`

### Phase 4: Frontend (if applicable)
- Add API call in `web/src/`
- Add/update React component

### Phase 5: Integration & Validation
- Register route in `index.ts`
- Run validation commands
- Manual smoke test

---

## STEP-BY-STEP TASKS

### Task 1: {ACTION} {file}
- **IMPLEMENT**: {specific detail}
- **PATTERN**: {file:line to mirror}
- **GOTCHA**: {known pitfall}
- **VALIDATE**: `pnpm --filter @fragmint/server typecheck`

{...continue for each task...}

---

## VALIDATION COMMANDS

```bash
# After each task:
pnpm --filter @fragmint/server typecheck

# After all tasks:
pnpm lint
pnpm test
pnpm build

# Manual smoke test:
curl -s http://localhost:3333/v1/{endpoint} | jq .
```

---

## ACCEPTANCE CRITERIA

- [ ] All validation commands pass with zero errors
- [ ] Auth applied to appropriate routes
- [ ] Zod validation on all inputs
- [ ] No files exceed 300 lines
- [ ] Unit tests cover core logic
- [ ] No regressions in existing tests

---

## NOTES

{Design decisions, trade-offs, known limitations}
```

---

## Quality Checklist

- [ ] All file references include line numbers where relevant
- [ ] Every task has a VALIDATE command
- [ ] Patterns are extracted from actual code (file:line)
- [ ] Auth requirements clearly stated
- [ ] Milvus dependency clearly marked as optional
- [ ] Plan is 500–700 lines
