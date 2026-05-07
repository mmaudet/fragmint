---
name: code-analyzer
description: Deep code analysis in isolated context. Use when you need comprehensive codebase analysis without cluttering main conversation. Analyzes complexity, dependencies, patterns, and technical debt.
argument-hint: [directory-or-file]
disable-model-invocation: false
context: fork
agent: Explore
allowed-tools: Read, Grep, Glob
model: haiku
---

# Code Analyzer: Deep Codebase Analysis

Performs comprehensive code analysis in an isolated subagent context, keeping verbose output separate from your main conversation.

## What This Skill Does

This skill runs in a **forked context** (separate subagent), which means:
- ✅ Verbose analysis doesn't clutter your main conversation
- ✅ Uses fast Haiku model for cost-effective analysis
- ✅ Read-only tools prevent accidental modifications
- ✅ Returns concise summary to main conversation

## Analysis Target

Analyze: **$ARGUMENTS** (default: current working directory)

## Analysis Process

### 1. Codebase Structure

Map the directory structure and identify key components:

```bash
# Find all source files by type
TypeScript: !`find $ARGUMENTS -name "*.ts" -not -path "*/node_modules/*" | wc -l`
JavaScript: !`find $ARGUMENTS -name "*.js" -not -path "*/node_modules/*" | wc -l`
Tests: !`find $ARGUMENTS -name "*.test.*" -o -name "*.spec.*" | wc -l`
```

Identify:
- Total files by language
- Directory organization
- Test file distribution
- Configuration files

### 2. Complexity Analysis

Analyze code complexity:

**File Size Distribution:**
- Find files > 500 lines (potential refactor candidates)
- Identify largest files (complexity hotspots)
- Check average file size

**Import Dependencies:**
- Map import/require statements
- Identify highly coupled files
- Find circular dependencies
- Detect unused imports

**Function Complexity:**
- Count functions per file
- Identify long functions (> 50 lines)
- Check nesting depth

### 3. Pattern Detection

Search for common patterns and anti-patterns:

**Good Patterns:**
- Consistent error handling
- Proper TypeScript typing
- Test coverage
- Clear separation of concerns
- Proper logging

**Anti-Patterns:**
- TODO/FIXME comments
- Commented-out code
- Magic numbers
- Large functions
- Deep nesting (> 3 levels)
- Type assertions (`as any`, `@ts-ignore`)

### 4. Technical Debt Assessment

Identify technical debt:

```bash
# Find TODO/FIXME comments
!`grep -r "TODO\|FIXME" $ARGUMENTS --include="*.ts" --include="*.js" | wc -l`

# Find ts-ignore comments
!`grep -r "@ts-ignore\|@ts-expect-error" $ARGUMENTS --include="*.ts" | wc -l`

# Find console.log (should use logger)
!`grep -r "console\.log" $ARGUMENTS --include="*.ts" --include="*.js" | wc -l`
```

Categorize by severity:
- 🔴 **Critical**: Security issues, hardcoded secrets
- 🟡 **High**: Type safety violations, missing error handling
- 🟢 **Medium**: Code smells, minor refactoring opportunities
- 🔵 **Low**: Style inconsistencies, missing comments

### 5. Dependency Analysis

Analyze external dependencies:

- Check package.json for outdated packages
- Identify heavy dependencies
- Find unused dependencies
- Check for security vulnerabilities

### 6. Code Quality Metrics

Calculate quality metrics:

**Maintainability Index:**
- Lines of code per file
- Cyclomatic complexity estimate
- Comment density
- Test coverage ratio

**Consistency Score:**
- Naming conventions adherence
- Import statement organization
- Error handling patterns
- Logging patterns

## Analysis Output Format

Provide a concise summary in this structure:

### 📊 Codebase Overview

- **Total Files**: X TypeScript, Y JavaScript, Z Tests
- **Lines of Code**: ~XX,XXX
- **Test Coverage**: XX files with tests (YY%)
- **Directory Structure**: [Brief description]

### 🎯 Complexity Assessment

**Overall Complexity**: [Low/Medium/High]

**Hotspots** (files needing attention):
1. `file/path.ts` (XXX lines, YY functions)
2. `another/file.ts` (XXX lines, high coupling)

**Metrics**:
- Average file size: XX lines
- Files > 500 lines: Y files
- Largest file: `path/to/file.ts` (XXX lines)

### ⚠️ Technical Debt

**Debt Score**: [Low/Medium/High]

**Issues Found**:
- 🔴 **Critical** (X): [List top 3]
- 🟡 **High** (Y): [List top 3]
- 🟢 **Medium** (Z): [Summary]

**Quick Wins** (easy fixes with high impact):
1. [Action item]
2. [Action item]

### ✅ Strengths

**What's Working Well**:
- [Positive pattern 1]
- [Positive pattern 2]
- [Good practice identified]

### 🔍 Patterns Detected

**Common Patterns**:
- Error Handling: [Description of pattern]
- Logging: [Logger usage pattern]
- Testing: [Test pattern]
- Type Safety: [TypeScript usage]

**Anti-Patterns**:
- [Anti-pattern 1]: X occurrences
- [Anti-pattern 2]: Y occurrences

### 📦 Dependencies

- **Total**: X dependencies (Y dev dependencies)
- **Outdated**: [List if any]
- **Unused**: [List if found]
- **Heavy**: [Large deps > 10MB]

### 🎯 Recommendations

**Immediate Actions** (Priority: High):
1. [Specific actionable recommendation]
2. [Specific actionable recommendation]

**Future Improvements** (Priority: Medium):
1. [Improvement suggestion]
2. [Improvement suggestion]

**Long-term** (Priority: Low):
- [Strategic improvement]

### 📈 Trends

If analyzing over time:
- Codebase is growing/shrinking
- Test coverage improving/declining
- Complexity increasing/decreasing

---

## Analysis Examples

See [examples/analysis-report-example.md](examples/analysis-report-example.md) for a sample output.

## Why Forked Context?

This skill uses `context: fork` which means it runs in a separate subagent:

**Benefits**:
- Your main conversation stays clean
- Can perform extensive file reads without bloating context
- Uses cheaper Haiku model for cost efficiency
- Read-only access prevents accidental changes
- Returns only the summary, not all the analysis steps

**Trade-offs**:
- Doesn't have access to your conversation history
- Cannot see your recent changes unless committed
- Results are one-way (summary only)

## Usage Examples

**Analyze entire codebase:**
```
/code-analyzer .
```

**Analyze specific directory:**
```
/code-analyzer src/services
```

**Analyze single file:**
```
/code-analyzer src/lib/auth/auth.service.ts
```

**With focus area:**
```
/code-analyzer src/ focus on security and performance
```

---

## Pro Tips

1. **Run before major refactors** to establish baseline
2. **Use after code reviews** to catch systematic issues
3. **Compare reports over time** to track technical debt
4. **Focus analysis** by specifying directory/file
5. **Review regularly** (weekly/monthly) to prevent debt accumulation

## Customization

To adjust the analysis focus, edit this skill's prompts to emphasize:
- Security-specific analysis
- Performance bottleneck detection
- Accessibility compliance
- Framework-specific patterns
- Your team's coding standards

The skill will use your custom focus while maintaining the core analysis structure.
