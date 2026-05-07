---
description: Execute a Fragmint implementation plan with rigorous validation loops
argument-hint: <path/to/plan.md>
---

# Implement Plan

**Plan**: $ARGUMENTS

---

## Mission

Execute the plan end-to-end with rigorous self-validation. Fix issues immediately — never accumulate broken state.

**Golden Rule**: If typecheck fails after any file change, fix it before the next task.

---

## Phase 0: DETECT — Project Environment

- Package manager: **pnpm** (always for Fragmint)
- TypeScript runner: `pnpm --filter @fragmint/server typecheck`
- Lint: `pnpm lint`
- Tests: `pnpm test`
- Build: `pnpm build`

Detect base branch:
```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
```

---

## Phase 1: LOAD — Read the Plan

```bash
cat $ARGUMENTS
```

Extract:
- Summary (what we're building)
- Patterns to Mirror (which files to read first)
- Files to Change (CREATE/UPDATE list)
- Step-by-Step Tasks (execution order)
- Validation Commands
- Acceptance Criteria

If plan not found: `Error: Plan not found at $ARGUMENTS. Create one with /prp-plan "description"`

---

## Phase 2: PREPARE — Git State

```bash
git branch --show-current
git status --porcelain
```

| State | Action |
|-------|--------|
| On `main`, clean | `git checkout -b feature/{plan-slug}` |
| On `main`, dirty | STOP: "Stash or commit changes first" |
| On feature branch | Use it |

```bash
git fetch origin
git pull --rebase origin main 2>/dev/null || true
```

---

## Phase 3: EXECUTE — Implement Tasks

For each task in the plan:

### 3.1 Read Context

Read the MIRROR file referenced in the task. Understand the pattern.

### 3.2 Implement

Make the change exactly as specified. Follow the pattern from MIRROR reference. Handle GOTCHA warnings.

### 3.3 Validate Immediately

```bash
pnpm --filter @fragmint/server typecheck
```

If this fails:
1. Read the error
2. Fix it
3. Re-run
4. Only proceed when passing

### 3.4 Track Progress

```
Task 1: CREATE packages/server/src/schema/xxx.ts ✅
Task 2: CREATE packages/server/src/services/xxx-service.ts ✅
Task 3: UPDATE packages/server/src/index.ts ✅
```

---

## Phase 4: VALIDATE — Full Verification

### 4.1 Static Analysis

```bash
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck  # if web changes
pnpm lint
```

### 4.2 Unit Tests

Write tests for new code. Run:

```bash
pnpm test
```

Fix failures before proceeding.

### 4.3 Build

```bash
pnpm build
```

### 4.4 Integration Smoke Test

```bash
# Start server
pnpm --filter @fragmint/server dev &
sleep 3

# Test new endpoint
curl -s http://localhost:3333/v1/{new-endpoint} | jq .

# Stop
lsof -ti:3333 | xargs kill 2>/dev/null || true
```

---

## Phase 5: REPORT — Create Implementation Report

```bash
mkdir -p .claude/PRPs/reports
```

**Path**: `.claude/PRPs/reports/{plan-name}-report.md`

```markdown
# Implementation Report

**Plan**: $ARGUMENTS
**Branch**: {branch}
**Date**: {YYYY-MM-DD}
**Status**: COMPLETE | PARTIAL

## Summary
{Brief description of what was implemented}

## Tasks Completed
| # | Task | File | Status |
|---|------|------|--------|
| 1 | {desc} | `path/file.ts` | ✅ |

## Validation Results
| Check | Result | Details |
|-------|--------|---------|
| typecheck (server) | ✅ | No errors |
| typecheck (web) | ✅/⏭️ | {N/A or result} |
| lint | ✅ | 0 errors |
| tests | ✅ | N passed |
| build | ✅ | Success |

## Files Changed
| File | Action | Lines |
|------|--------|-------|
| `packages/server/src/routes/xxx.ts` | CREATE | +120 |

## Deviations from Plan
{None, or list each with rationale}

## Tests Written
| Test File | Test Cases |
|-----------|-----------|
| `packages/server/src/xxx.test.ts` | list_returns_filtered_results, ... |

## Next Steps
- [ ] Review the report
- [ ] Create PR: /prp-pr
```

Archive plan:
```bash
mkdir -p .claude/PRPs/plans/completed
mv $ARGUMENTS .claude/PRPs/plans/completed/
```

---

## Phase 6: OUTPUT — Report to User

```markdown
## Implementation Complete

**Plan**: $ARGUMENTS
**Branch**: {branch}
**Status**: ✅ Complete

### Validation
| Check | Result |
|-------|--------|
| typecheck | ✅ |
| lint | ✅ |
| tests | ✅ ({N} passed) |
| build | ✅ |

### Files Changed
- {N} files created
- {M} files updated
- {K} tests written

### Report: `.claude/PRPs/reports/{name}-report.md`

### Next Steps
1. Review the report
2. Create PR: `/prp-pr`
```

---

## Handling Failures

| Failure | Action |
|---------|--------|
| Typecheck fails | Read error, fix type, re-run — don't proceed |
| Test fails | Fix implementation (usually), not test |
| Lint fails | Run `pnpm lint --fix` then manual fixes |
| Build fails | Usually a type/import issue — check error |
| Server won't start | Check `packages/server/src/index.ts` wiring |
