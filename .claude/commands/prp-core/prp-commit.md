---
description: Quick commit with natural language file targeting, conforming to project commit conventions
argument-hint: [target description] (blank = all changes)
---

# Commit

**Target**: $ARGUMENTS

---

## Your Mission

Stage files matching the target, write a commit message that strictly follows the project's commit conventions defined in `/CLAUDE.md`, then commit.

---

## Phase 0: PRE-FLIGHT — Read conventions

Before anything else, read the "Git Workflow" section of `/CLAUDE.md`. The commit message MUST follow the format defined there. Do not skip this step, even if you think you remember the format.

---

## Phase 1: ASSESS

```bash
git status --short
```

If nothing to commit, stop.

---

## Phase 2: INTERPRET & STAGE

**Target interpretation:**

| Input                       | Action                                  |
| --------------------------- | --------------------------------------- |
| (blank)                     | `git add -A` (all changes)              |
| `staged`                    | Use current staging                     |
| `*.ts` / `typescript files` | `git add "*.ts"`                        |
| `files in src/X`            | `git add src/X/`                        |
| `except tests`              | Add all, then `git reset *test* *spec*` |
| `only new files`            | Add only untracked files                |
| `the X changes`             | Interpret from diff/context             |

Stage the matching files. Show what will be committed:

```bash
git diff --cached --name-only
```

---

## Phase 3: COMMIT

### Format (mandatory)

<type>(<scope>): <description>

Or with bug reference:
<type>(<scope>): <description> (#N)
<type>(<scope>): <description> (#N, #M)

### Allowed types

- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation only
- `refactor` — code change without behavior change
- `test` — adding or updating tests
- `chore` — maintenance, tooling, gitignore, deps

### Scope

- Required, kept short (1 word ideally, 2 max with hyphen)
- Common scopes for this repo: `composer`, `harvester`, `search`, `web`, `server`, `mcp`, `cli`, `docker`, `dev`, `templates`, `auth`, `claude`, `db`
- Be consistent with previous commits — check `git log --oneline | head -20` if unsure

### Description rules

- Imperative mood: "add", "fix", "update" (NOT "added", "fixes", "updating")
- Lowercase first letter
- No period at the end
- Concise but specific

### Bug references

If the commit fixes one or more bugs documented in `.claude/mission/BUGS.md` (when accessible) or commonly known bugs, append the reference:

- Single bug: `(#3)`
- Multiple bugs: `(#3, #9)`

### Pre-commit checklist

Before running `git commit`, validate mentally:

- [ ] Type is one of: feat, fix, docs, refactor, test, chore
- [ ] Scope is present and meaningful
- [ ] Description is in imperative mood, lowercase, no period
- [ ] Bug references included if applicable
- [ ] Only files for this logical change are staged (never mix unrelated changes)

### Examples — good

fix(composer): use template output_format instead of hardcoded docx (#16)
fix(docker): add /v1 suffix to EMBEDDING_ENDPOINT (#3)
docs(claude): add system-architecture reference in Resources section
chore(dev): add Claude Code agentic workflows
refactor(harvester): extract classification prompt into separate module
feat(search): add quality re-ranking to semantic search

### Examples — bad (do NOT use these patterns)

update composer service ← missing type/scope
fix: composer fix ← missing scope, vague description
Fix(Composer): Fixed the docx bug ← capitalization wrong, past tense
fix(composer): use template output_format. ← period at end
chore: misc updates ← missing scope, vague

### Commit

```bash
git commit -m "<type>(<scope>): <description>"
```

---

## Phase 4: OUTPUT

```markdown
**Committed**: {hash} - {message}
**Files**: {count} files (+{add}/-{del})

Next: `git push` or `/prp-pr`
```

---

## Phase 5: ATOMIC COMMITS RULE

If the staged changes mix unrelated logical changes (e.g., a bug fix in the composer AND a docs update AND a docker fix), STOP and propose to split into multiple atomic commits.

A commit must represent ONE logical change. Mixing unrelated changes in a single commit hurts readability for code reviewers and breaks `git revert`.

---

## Examples

```
/prp-commit                          # All changes (warns if mixed)
/prp-commit typescript files         # *.ts only
/prp-commit except package-lock      # Exclude specific
/prp-commit only the new files       # Untracked only
/prp-commit staged                   # Already-staged only
```
