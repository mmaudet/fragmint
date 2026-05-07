---
description: Execute a Fragmint implementation plan
argument-hint: <path/to/plan.md>
---

# Execute: Implement from Plan

**Plan**: $ARGUMENTS

---

## Mission

Execute the plan end-to-end with rigorous self-validation. Fix every failure before moving on.

**Golden Rule**: If `pnpm --filter @fragmint/server typecheck` fails, fix it before the next task.

---

## Phase 0: Setup

### Detect State

```bash
git branch --show-current
git status --short
cat package.json | grep '"packageManager"'
```

Package manager: **pnpm** (always).

### Read Plan

```bash
cat $ARGUMENTS
```

Extract:
- Tasks list (Step-by-Step Tasks section)
- Validation commands
- Acceptance criteria

---

## Phase 1: Git Branch

| State | Action |
|-------|--------|
| On `main`, clean | `git checkout -b feature/{plan-slug}` |
| On `main`, dirty | STOP: commit or stash first |
| On feature branch | Use it |

```bash
git fetch origin
git pull --rebase origin main 2>/dev/null || true
```

---

## Phase 2: Execute Tasks

For each task in the plan:

1. **Read the MIRROR file** referenced in the task
2. **Implement** following the pattern exactly
3. **Validate immediately**:
   ```bash
   pnpm --filter @fragmint/server typecheck
   ```
4. If types fail → fix before next task
5. Log: `Task N: {description} ✅`

**Deviation Handling**: If you must deviate, document what changed and why.

---

## Phase 3: Full Validation

After all tasks:

```bash
# Type check all packages
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck

# Lint
pnpm lint

# Unit tests
pnpm test

# Build
pnpm build
```

Fix any failure before proceeding.

### Integration Smoke Test

```bash
# Start server (if not running)
pnpm --filter @fragmint/server dev &
sleep 3

# Test new endpoint
curl -s http://localhost:3333/v1/{new-endpoint} | jq .

# Stop
lsof -ti:3333 | xargs kill 2>/dev/null || true
```

---

## Phase 4: Implementation Report

Create `.claude/PRPs/reports/{plan-name}-report.md`:

```markdown
# Implementation Report

**Plan**: $ARGUMENTS
**Branch**: {branch}
**Date**: {YYYY-MM-DD}
**Status**: COMPLETE | PARTIAL

## Summary
{What was implemented}

## Tasks Completed
| # | Task | File | Status |
|---|------|------|--------|
| 1 | {desc} | `path/file.ts` | ✅ |

## Validation Results
| Check | Result | Details |
|-------|--------|---------|
| typecheck (server) | ✅ | No errors |
| typecheck (web) | ✅/⏭️ | N/A |
| lint | ✅ | 0 errors |
| tests | ✅ | N passed |
| build | ✅ | Success |

## Files Changed
| File | Action | Lines |
|------|--------|-------|
| `packages/server/src/routes/xxx.ts` | CREATE | +120 |

## Deviations from Plan
{None, or list with rationale}

## Next Steps
- [ ] Review report
- [ ] Create PR: `/prp-pr`
```

Archive plan:
```bash
mkdir -p .claude/PRPs/plans/completed
mv $ARGUMENTS .claude/PRPs/plans/completed/
```

---

## Phase 5: Report to User

```markdown
## Implementation Complete

**Plan**: $ARGUMENTS
**Branch**: {branch}
**Status**: ✅

### Validation
| Check | Result |
|-------|--------|
| typecheck | ✅ |
| lint | ✅ |
| tests | ✅ ({N} passed) |
| build | ✅ |

### Files Changed
- {N} files created / {M} files modified

### Next Steps
1. Review: `.claude/PRPs/reports/{name}-report.md`
2. Create PR: `/prp-pr`
```
