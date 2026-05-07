---
description: Deep-analysis feature planning for Fragmint — produces a comprehensive plan file
argument-hint: <feature description>
---

# PRP Plan: Deep Fragmint Feature Planning

## Feature: $ARGUMENTS

## Mission

Create a context-rich implementation plan through systematic codebase analysis. No code is written here — only the plan.

**Key Philosophy**: Context is King. The plan must contain ALL information needed for implementation — patterns, mandatory reading, validation commands — so the execution agent succeeds on the first attempt.

**Hard Constraint**: Final plan MUST be 500–700 lines. Be concise but comprehensive.

---

## Phase 1: Feature Understanding

**Deep Analysis**:
- Core problem being solved
- User value
- Feature type: New Route / New Service / UI / MCP Tool / Bugfix / Refactor / Config
- Complexity: Low / Medium / High
- Affected packages: server / web / mcp / cli

**User Story**:
```
As a <role: reader|contributor|expert|admin>
I want to <action>
So that <benefit>
```

---

## Phase 2: Codebase Intelligence

Use parallel subagents when exploring multiple areas. Check:

### 2a. Similar Existing Implementations

```bash
# Route patterns
grep -r "app\.get\|app\.post\|app\.patch\|app\.delete" packages/server/src/routes/ -l

# Service patterns
ls packages/server/src/services/

# Zod schema patterns
ls packages/server/src/schema/

# Drizzle query patterns
grep -rn "db\.select\|db\.insert\|db\.update\|db\.delete" packages/server/src/ | head -20
```

### 2b. Always Read These

- `packages/server/src/db/schema.ts` — full DB model
- `packages/server/src/config.ts` — env defaults
- `packages/server/src/index.ts` — service wiring

### 2c. Testing Patterns

```bash
find packages -name "*.test.ts" | head -10
cat {first relevant test file}
```

### 2d. Auth Patterns

```bash
cat packages/server/src/auth/auth-middleware.ts 2>/dev/null || ls packages/server/src/auth/
```

### 2e. Frontend (if UI work)

```bash
ls packages/web/src/components/
cat packages/web/src/components/{similar-component}.tsx
```

---

## Phase 3: External Research

Check:
- `.claude/external-docs/fragmint-stack.md` for Fragmint-specific patterns
- Official docs for any new external library (verify API before planning)

**External Package API Verification** (when adding new dependencies):
1. Check if package is already in `package.json`
2. Verify import names (PyPI name ≠ import name pattern also happens in npm)
3. Test actual API shape before planning around it

---

## Phase 4: Strategic Design

Think about:
- Does this need a new Drizzle table/column? (Needs migration)
- Does this use Milvus? (Must be optional — check `milvus_enabled`)
- Does this need new auth scopes? (Which roles get access?)
- Can Milvus be down and the feature still work?
- What happens if Ollama is down? (Graceful degradation)
- Fragment lifecycle implications? (draft→reviewed→approved)

---

## Phase 5: Plan Generation

Create `.claude/PRPs/plans/{kebab-case-name}.plan.md`:

```markdown
# Plan: {feature-name}

> Validate all patterns against the actual codebase before implementing. Pay attention to import paths and exact function signatures.

## Feature Description
{Detailed description}

## User Story
As a {role}
I want to {action}
So that {benefit}

## Feature Metadata
**Type**: New Route | Service Enhancement | UI | MCP Tool | Bugfix | Refactor
**Complexity**: Low | Medium | High
**Affected Packages**: server, web, mcp, cli (mark all that apply)
**Milvus Required**: Yes | No | Optional
**New DB Schema**: Yes | No

---

## CONTEXT REFERENCES

### MANDATORY: Read Before Implementing

- `packages/server/src/routes/{similar}.ts` (lines X–Y) — mirror route pattern
- `packages/server/src/services/{similar}-service.ts` — mirror service pattern
- `packages/server/src/schema/{similar}.ts` — mirror Zod schema
- `packages/server/src/db/schema.ts` — full Drizzle schema
- `packages/server/src/index.ts` (lines X–Y) — service wiring pattern
- {other specific files with line numbers}

### New Files to Create

- `packages/server/src/routes/{name}.ts`
- `packages/server/src/services/{name}-service.ts`
- `packages/server/src/schema/{name}.ts`
- `packages/server/src/{name}.test.ts` (or co-located)

### Patterns to Follow

**Route Registration** (from `packages/server/src/index.ts`):
```typescript
import { xxxRoutes } from './routes/xxx.js';
app.register(xxxRoutes);
```

**Zod Schema** (from `packages/server/src/schema/fragment.ts`):
```typescript
export const ListXxxSchema = z.object({
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListXxxQuery = z.infer<typeof ListXxxSchema>;
```

**Fastify Route** (from `packages/server/src/routes/fragments.ts`):
```typescript
app.get('/v1/xxx', {
  schema: { querystring: ListXxxSchema },
  preHandler: [app.authenticate],  // if auth required
}, async (req, reply) => {
  const results = await req.server.xxxService.list(req.query);
  return reply.send(results);
});
```

**Drizzle Query** (from `packages/server/src/services/fragment-service.ts`):
```typescript
const rows = await db.select().from(xxx).where(
  and(eq(xxx.type, type), gte(xxx.created_at, since))
).limit(limit);
```

{Extract other specific patterns from the codebase}

---

## IMPLEMENTATION PLAN

### Phase 1: Schema Foundation
{Zod schemas + DB changes if needed}

### Phase 2: Service Layer
{Service class + unit tests}

### Phase 3: Route Layer
{Fastify route + auth + wiring}

### Phase 4: Frontend (if applicable)
{API client + React component}

### Phase 5: Integration
{Register in index.ts + smoke test}

---

## STEP-BY-STEP TASKS

### Task 1: {ACTION} `{file}`
- **IMPLEMENT**: {specific detail}
- **PATTERN**: `{file}:{line}` — {what to mirror}
- **IMPORTS**: {exact imports needed}
- **GOTCHA**: {known pitfall, e.g., "Milvus must be optional"}
- **VALIDATE**: `pnpm --filter @fragmint/server typecheck`

### Task 2: {ACTION} `{file}`
- **IMPLEMENT**: {specific detail}
- **VALIDATE**: `pnpm --filter @fragmint/server typecheck`

{...continue for all tasks...}

---

## TESTING STRATEGY

### Unit Tests (Vitest)

Pattern: test service functions directly with in-memory SQLite.

```typescript
describe('XxxService', () => {
  it('returns results filtered by type', async () => {
    // Arrange: seed test data
    // Act: call service method
    // Assert: check results
  });
});
```

### Integration / E2E (Playwright)

For new API routes:
```typescript
// e2e/xxx.spec.ts
test('GET /v1/xxx returns list', async ({ request }) => {
  const res = await request.get('/v1/xxx');
  expect(res.ok()).toBeTruthy();
});
```

### Edge Cases to Test

- Missing optional parameters → defaults applied
- Milvus disabled → graceful fallback
- Empty result set → returns `[]` not error
- Auth required route without token → 401
- {feature-specific edge cases}

---

## VALIDATION COMMANDS

```bash
# Level 1: After each file change
pnpm --filter @fragmint/server typecheck

# Level 2: Syntax & style
pnpm lint

# Level 3: Unit tests
pnpm test

# Level 4: Build
pnpm build

# Level 5: Manual smoke test
curl -s http://localhost:3333/v1/{endpoint} | jq .
```

---

## ACCEPTANCE CRITERIA

- [ ] All validation commands pass with zero errors
- [ ] Auth applied to routes requiring it
- [ ] Zod validation on all inputs
- [ ] No files exceed 300 lines
- [ ] Milvus operations guarded by `milvus_enabled` check
- [ ] Unit tests cover core service logic
- [ ] No regressions in existing tests

---

## NOTES

{Design decisions, trade-offs, known limitations}
```

---

## Report

After creating the plan, provide:
- Summary of feature and approach
- Full path to plan file
- Complexity assessment
- Key risks or gotchas
- Confidence score (X/10) for one-pass implementation success
