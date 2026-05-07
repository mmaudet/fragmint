# Fragmint — Agentic Coding Workflows

This file explains how to use the commands, agents, and skills in `.claude/` to develop Fragmint features efficiently.

---

## Core Concept: PIV Loop

Every feature follows **Prepare → Implement → Validate**:

```
PREPARE:   Load context → Plan the feature
IMPLEMENT: Execute the plan task by task (validate types after each change)
VALIDATE:  Run full test suite, lint, build, smoke test
```

Two sets of commands implement this loop — choose based on feature complexity.

---

## Workflow A — Simple Features

Use for: new endpoint, small service addition, UI component, bug fix.

```
/prime
/core_piv_loop:plan-feature "add endpoint to filter fragments by tag"
/core_piv_loop:execute .claude/PRPs/plans/{generated-name}.plan.md
/validation:validate
```

**When to use**: The feature touches 1–2 files, the pattern is obvious from existing code.

---

## Workflow B — Complex Features

Use for: new flow (harvest, compose), Milvus integration, multi-package change, significant refactor.

```
/prime
/prp-core:prp-plan "add streaming support to document compose endpoint"
/prp-core:prp-implement .claude/PRPs/plans/{generated-name}.plan.md
/validation:validate
```

**When to use**: The feature touches multiple layers (Zod + Drizzle + Fastify + possibly Milvus + possibly web), or you're uncertain about the approach.

**Key difference vs Workflow A**:
- Planning phase spawns parallel codebase analysis agents
- Produces a richer plan (500–700 lines) with all patterns extracted, gotchas documented, confidence score
- Implementation phase runs a 6-phase execution loop with an archived report at the end

---

## Difference Between the Two Plan Commands

| | `plan-feature` | `prp-plan` |
|--|--|--|
| Phases | 5 | 6 (adds external research phase) |
| Codebase analysis | Sequential | Parallel subagents |
| Plan length | Moderate | 500–700 lines enforced |
| Confidence score | No | Yes |
| Best for | Known patterns | Uncertain / multi-layer |

Both produce the same output format: `.claude/PRPs/plans/{name}.plan.md`

---

## Difference Between the Two Execute Commands

| | `execute` | `prp-implement` |
|--|--|--|
| Validation per task | `typecheck` after each file | Same |
| Final validation | Full suite | Full suite |
| Report | Basic | Detailed (assessment vs. reality, deviations) |
| Plan archiving | No | Yes → `PRPs/plans/completed/` |
| Best for | Quick iteration | Thorough implementation |

---

## Debug Workflow

When something is broken and you need root cause analysis:

```
/prp-core:prp-debug "TypeError: Cannot read property 'body' of undefined in composer-service.ts"
```

Output: `.claude/PRPs/debug/rca-{slug}.md` with evidence chain + fix specification.

---

## PR Workflow

After implementation is complete:

```
/prp-core:prp-commit           # stage and commit with conventional message
/prp-core:prp-pr               # push + create GitHub PR from current branch
/prp-core:prp-review 123       # review PR #123 (Fragmint-specific checklist)
```

---

## Code Generation

Generate a complete feature scaffold (Zod schema + Fastify route + service + unit test):

```
/fragmint-feature tag-suggestions
```

This generates 4 files and prints the wiring instructions for `index.ts`. You then fill in the business logic.

---

## Code Analysis

Analyze a directory or file for complexity, debt, anti-patterns:

```
/code-analyzer packages/server/src/services
```

Runs in an isolated subagent (forked context) — output stays clean.

---

## Available Agents

Agents run autonomously via the Agent tool (or Claude spawns them during complex commands):

| Agent | When it runs |
|-------|-------------|
| `coder` | Writing/modifying production code |
| `code-reviewer` | After implementing a feature chunk |
| `system-review` | After implementation — analyzes process vs. plan |
| `meta-agent` | Creating new custom agents |

---

## Session Start (Always)

At the beginning of every coding session:

```
/prime
```

This loads: git state, package structure, recent commits, config defaults, any pending plans. Takes ~10 seconds and prevents working on stale context.

---

## Quick Reference

| Goal | Command |
|------|---------|
| Start session | `/prime` |
| Plan simple feature | `/core_piv_loop:plan-feature "description"` |
| Plan complex feature | `/prp-core:prp-plan "description"` |
| Execute a plan | `/core_piv_loop:execute path/to/plan.md` |
| Execute (detailed) | `/prp-core:prp-implement path/to/plan.md` |
| Full validation | `/validation:validate` |
| Debug a bug | `/prp-core:prp-debug "error description"` |
| Generate scaffold | `/fragmint-feature feature-name` |
| Commit | `/prp-core:prp-commit` |
| Create PR | `/prp-core:prp-pr` |
| Review PR | `/prp-core:prp-review 123` |
| Analyze code | `/code-analyzer path/` |
