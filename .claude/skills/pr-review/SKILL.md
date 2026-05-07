---
name: pr-review
description: Comprehensive GitHub PR review with complexity analysis. Use when reviewing pull requests or when user asks to analyze a PR. Automatically fetches PR context from GitHub CLI.
argument-hint: [pr-number]
disable-model-invocation: false
allowed-tools: Bash(gh *), Read, Grep, Glob
model: inherit
---

# PR Review: Comprehensive Pull Request Analysis

Perform a thorough review of a GitHub pull request with automated complexity analysis and best practices checking.

## Dynamic Context (Auto-injected)

The following context is automatically fetched when this skill runs:

**PR Diff:**
```
!`gh pr view $ARGUMENTS --json diff --jq .diff 2>/dev/null || echo "No PR specified. Usage: /pr-review [pr-number]"`
```

**PR Metadata:**
```
!`gh pr view $ARGUMENTS --json number,title,author,createdAt,additions,deletions 2>/dev/null || echo ""`
```

**Changed Files:**
```
!`gh pr diff $ARGUMENTS --name-only 2>/dev/null || echo ""`
```

## Review Process

Follow these steps for comprehensive PR review:

### 1. **Context Understanding**
- Review PR title, description, and metadata
- Identify the type of change (feature, bugfix, refactor, etc.)
- Note the scope (number of files, lines changed)

### 2. **Code Quality Analysis**
- **Readability**: Clear naming, proper structure, good comments
- **Maintainability**: DRY principles, logical organization
- **Performance**: Efficient algorithms, no obvious bottlenecks
- **Security**: No exposed secrets, proper input validation
- **Error Handling**: Comprehensive error cases covered

### 3. **Complexity Assessment**
Run the complexity analysis script for quantitative metrics:

```bash
bash .claude/skills/pr-review/scripts/analyze-complexity.sh $ARGUMENTS
```

### 4. **Best Practices Check**
- [ ] Follows project coding standards (check CLAUDE.md)
- [ ] Tests included for new functionality
- [ ] No breaking changes without migration plan
- [ ] Documentation updated if needed
- [ ] Commit messages are clear and descriptive

### 5. **Pattern Matching**
Check against common anti-patterns:
- Large functions (>50 lines) that should be split
- Deep nesting (>3 levels) that needs refactoring
- Commented-out code that should be removed
- TODO comments without tracking issues
- Hardcoded values that should be configurable

## Review Output Format

Provide your review in this structure:

### 📊 PR Summary
- **Title**: [PR Title]
- **Author**: [Author]
- **Type**: [Feature/Bugfix/Refactor/etc.]
- **Scope**: [X files, +Y/-Z lines]
- **Complexity Score**: [From script - Low/Medium/High]

### ✅ Strengths
- [What's done well in this PR]
- [Positive patterns to highlight]

### ⚠️ Issues Found

#### Critical (Must Fix)
- **[File:Line]**: [Issue description]
  - **Why**: [Explanation]
  - **Fix**: [Suggested solution]

#### Warnings (Should Fix)
- **[File:Line]**: [Issue description]
  - **Suggestion**: [How to improve]

#### Suggestions (Consider)
- [Optional improvements]
- [Nice-to-have enhancements]

### 🎯 Recommendations

**Approval Status**: [Approve / Request Changes / Needs Discussion]

**Next Steps**:
1. [Action item 1]
2. [Action item 2]

**For Future PRs**:
- [Learning points for the team]

## Supporting Resources

For detailed review checklists and examples, see:
- [templates/review-checklist.md](templates/review-checklist.md) - Comprehensive checklist
- Complexity analysis: Run `scripts/analyze-complexity.sh [pr-number]`

## Usage Examples

**Review specific PR:**
```
/pr-review 123
```

**Review current branch's PR:**
```
/pr-review
```

**Quick review focus:**
```
/pr-review 123 focus on security and performance
```

---

**Note**: This skill requires GitHub CLI (`gh`) to be installed and authenticated. If PR data cannot be fetched, the skill will guide you to provide the PR context manually.
