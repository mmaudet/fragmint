---
description: Comprehensive PR code review for Fragmint — checks diff, runs validation, posts to GitHub
argument-hint: <pr-number|pr-url> [--approve|--request-changes]
---

# PR Code Review

**Input**: $ARGUMENTS

---

## Mission

Perform a thorough code review with Fragmint-specific checks:

1. Understand what the PR accomplishes
2. Check code against Fragmint patterns (CLAUDE.md + this command)
3. Run all validation (typecheck, lint, tests, build)
4. Identify issues by severity
5. Post findings as PR comment + save local report

---

## Phase 1: FETCH — Get PR Context

```bash
# Parse PR number from input
gh pr view $ARGUMENTS --json number,title,body,author,headRefName,baseRefName,state,additions,deletions,changedFiles

# Get the diff
gh pr diff $ARGUMENTS

# List changed files
gh pr diff $ARGUMENTS --name-only

# Checkout branch
gh pr checkout $ARGUMENTS
```

| State | Action |
|-------|--------|
| MERGED | STOP: "PR already merged." |
| DRAFT | NOTE: "Draft PR — focus on direction" |
| OPEN | PROCEED |

---

## Phase 2: CONTEXT — Understand the Change

```bash
cat CLAUDE.md
```

Look for implementation artifacts:
```bash
ls .claude/PRPs/reports/*{branch-name}* 2>/dev/null
ls .claude/PRPs/plans/completed/ 2>/dev/null
```

Understand PR intent from title + description. Documented deviations in implementation report are INTENTIONAL.

---

## Phase 3: REVIEW — Fragmint-Specific Checklist

For every changed file in `packages/server/`:

#### Correctness
- [ ] Logic does what PR claims
- [ ] Edge cases handled (Milvus down, Ollama timeout, empty results)
- [ ] Error handling doesn't expose internals

#### Fragmint Patterns
- [ ] Zod schema on all route inputs (`schema: { querystring/body: ... }`)
- [ ] Auth hook applied to protected routes (`preHandler: [app.authenticate]`)
- [ ] Service uses constructor injection (no globals)
- [ ] Drizzle used for all DB access (no raw SQL with user input)
- [ ] `toMilvusPartition(slug)` used when mapping collections
- [ ] `milvus_enabled` checked before any Milvus operation
- [ ] No `console.log` (use `req.log` or Fastify logger)
- [ ] No hardcoded paths outside `config.ts`

#### Type Safety
- [ ] No implicit `any`
- [ ] Return types declared on service methods
- [ ] Zod schemas exported from `schema/`

#### File Size
- [ ] All files < 300 lines

#### Security
- [ ] Input validated at route level
- [ ] File paths sanitized (no path traversal)
- [ ] Tokens/secrets never logged

#### Performance
- [ ] No N+1 DB queries (batch, don't loop)
- [ ] LLM calls have timeouts
- [ ] No blocking sync operations in async handlers

For every changed file in `packages/web/`:
- [ ] React hooks rules followed
- [ ] API calls handle errors + loading states
- [ ] No hardcoded API URLs

---

## Phase 4: VALIDATE — Run Checks

```bash
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck
pnpm lint
pnpm test
pnpm build
```

---

## Phase 5: DECIDE — Recommendation

**APPROVE**: No critical/high issues + all validation passes
**REQUEST CHANGES**: High issues exist or validation fails
**BLOCK**: Security vulnerability or fundamental approach wrong

---

## Phase 6: REPORT — Generate and Post

Create `.claude/PRPs/reviews/pr-{NUMBER}-review.md` and post:

```bash
# Comment only (default)
gh pr comment {NUMBER} --body-file .claude/PRPs/reviews/pr-{NUMBER}-review.md

# Approve (if --approve flag)
gh pr review {NUMBER} --approve --body-file .claude/PRPs/reviews/pr-{NUMBER}-review.md

# Request changes (if --request-changes flag or high issues found)
gh pr review {NUMBER} --request-changes --body-file .claude/PRPs/reviews/pr-{NUMBER}-review.md
```

**Report structure**:

```markdown
# PR Review: #{NUMBER} - {TITLE}

**Recommendation**: {APPROVE/REQUEST CHANGES/BLOCK}

## Summary
{2–3 sentences}

## Fragmint Pattern Compliance
| Check | Result |
|-------|--------|
| Zod validation on inputs | ✅/❌ |
| Auth hooks applied | ✅/❌ |
| Service constructor injection | ✅/❌ |
| Milvus guarded | ✅/❌ |
| Files < 300 lines | ✅/❌ |

## Issues Found

### Critical
{None, or specific file:line issues}

### High Priority
{Issues that should block merge}

### Medium / Suggestions
{Non-blocking improvements}

## Validation Results
| Check | Result |
|-------|--------|
| typecheck | ✅/❌ |
| lint | ✅/❌ |
| tests | ✅/❌ |
| build | ✅/❌ |

## What's Good
{Acknowledge positive aspects}

## Next Steps
{Based on recommendation}
```
