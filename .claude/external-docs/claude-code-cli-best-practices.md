# Claude Code: Best Practices for Agentic Coding

> Source: https://www.anthropic.com/engineering/claude-code-best-practices

## Overview

Claude Code is a command-line tool for agentic coding that enables engineers to integrate Claude into their workflows. Claude Code is intentionally low-level and unopinionated, providing close to raw model access without forcing specific workflows.

This guide compiles proven patterns from Anthropic engineers and external users across various codebases and languages.

---

## 1. Customize Your Setup

### A. Create CLAUDE.md Files

The `CLAUDE.md` file automatically loads into Claude's context when starting conversations. Effective documentation includes:

- Common bash commands
- Core files and utility functions
- Code style guidelines
- Testing instructions
- Repository conventions (branching, merge strategies)
- Developer environment setup requirements
- Project-specific warnings or unexpected behaviors

**File Placement Options:**

- Repository root (shareable across team)
- Parent directories (useful for monorepos)
- Child directories (pulled on-demand)
- Home folder `~/.claude/CLAUDE.md` (applies globally)

Run `/init` to auto-generate a starter file.

### B. Tune CLAUDE.md Files

These files become part of Claude's prompts, requiring iterative refinement. Avoid adding excessive content without testing effectiveness.

Use the `#` key to instruct Claude to automatically incorporate guidance into relevant files. Many engineers use `#` frequently to document commands, files, and style guidelines while coding.

Anthropic teams occasionally process these through prompt improvers and add emphasis keywords like "IMPORTANT" or "YOU MUST" to improve adherence.

### C. Curate Allowed Tools

Claude Code conservatively requests permissions for system-modifying actions. Customize via four methods:

1. Select "Always allow" during prompts
2. Use `/permissions` command after starting Claude Code
3. Manually edit `.claude/settings.json` or `~/.claude.json`
4. Use `--allowedTools` CLI flag for session-specific permissions

Examples: `Edit`, `Bash(git commit:*)`, or `mcp__puppeteer__puppeteer_navigate`

### D. Install GitHub CLI

The `gh` CLI enables Claude to create issues, manage pull requests, and read comments. While GitHub API alternatives exist, native `gh` integration is preferable.

---

## 2. Give Claude More Tools

Claude inherits your shell environment and can leverage MCP servers and REST APIs.

### A. Use Bash Tools

Claude knows common utilities but requires instruction for custom tools:

1. Provide tool names with usage examples
2. Tell Claude to run `--help` for documentation
3. Document frequently-used tools in CLAUDE.md

### B. Use MCP (Model Context Protocol)

Claude functions as both MCP server and client, connecting to multiple servers via:

- **Project config** (directory-specific)
- **Global config** (all projects)
- **Checked-in .mcp.json file** (team-accessible)

Launch with `--mcp-debug` flag to troubleshoot configuration issues.

### C. Use Custom Slash Commands

Store reusable prompt templates in markdown files within `.claude/commands/` folder. They become available through the slash commands menu.

Support the special `$ARGUMENTS` keyword to pass parameters. Example for fixing GitHub issues:

```
Please analyze and fix the GitHub issue: $ARGUMENTS.

Follow these steps:
1. Use `gh issue view` to get issue details
2. Understand the problem
3. Search the codebase for relevant files
4. Implement necessary changes
5. Write and run tests
6. Ensure code passes linting and type checking
7. Create a descriptive commit message
8. Push and create a PR
```

Store in `.claude/commands/fix-github-issue.md` to access via `/project:fix-github-issue 1234`.

---

## 3. Common Workflows

### A. Explore, Plan, Code, Commit

This versatile pattern suits many problems:

1. **Ask Claude to read** relevant files, images, or URLs without writing code
   - Use subagents for complex verification, especially early in conversations
2. **Request a plan** for approaching the problem
   - Use "think" to trigger extended thinking mode ("think" < "think hard" < "think harder" < "ultrathink")
   - Save the plan as a document or GitHub issue for reference
3. **Ask Claude to implement** the solution while verifying reasonableness
4. **Request commit and PR** creation with updated documentation

**Important:** Steps #1-#2 are crucial—without them, Claude tends to jump straight to coding a solution.

### B. Write Tests, Commit; Code, Iterate, Commit

Test-driven development amplifies agentic coding effectiveness:

1. **Write tests** based on input/output pairs (explicitly mention TDD approach)
2. **Run tests** and confirm failures (forbid implementation code at this stage)
3. **Commit tests** when satisfied
4. **Write implementation code** to pass tests iteratively
5. **Use subagents** to verify implementation doesn't overfit to tests
6. **Commit** the final code

Claude excels with clear targets—tests provide measurable success criteria.

### C. Write Code, Screenshot Result, Iterate

Provide visual targets for UI development:

1. Provide screenshot capabilities (Puppeteer MCP server, iOS simulator MCP, or manual pasting)
2. Share design mocks as reference points
3. Request Claude implement the design, take screenshots, and iterate
4. Commit when satisfied

Claude's outputs typically look much better after 2-3 iterations.

### D. Safe YOLO Mode

Use `--dangerously-skip-permissions` to bypass permission checks for uninterrupted work. This suits lint fixes or boilerplate generation but carries significant risks—use only in containers without internet access.

### E. Codebase Q&A

Leverage Claude for learning new codebases through questions like:

- How does logging work?
- How do I create a new API endpoint?
- What does `async move { ... }` do on line 134 of foo.rs?
- What edge cases does this component handle?

Using Claude Code in this way has become Anthropic's core onboarding workflow, significantly improving ramp-up time.

### F. Git Interactions

Claude effectively handles:

- **Searching git history** to answer questions about changes and ownership
- **Writing commit messages** using surrounding context
- **Complex git operations** like rebases, conflict resolution, and patch comparisons

Many Anthropic engineers use Claude for 90%+ of their git interactions.

### G. GitHub Interactions

Claude manages:

- **Creating pull requests** (understands "pr" shorthand)
- **Implementing code review comments** (one-shot resolutions)
- **Fixing failing builds** or linter warnings
- **Categorizing and triaging** open issues

### H. Jupyter Notebooks

Researchers and data scientists use Claude to read, write, and improve notebooks. Suggest "aesthetically pleasing" improvements for visual optimization.

---

## 4. Optimize Your Workflow

### A. Be Specific in Instructions

More specific instructions significantly improve success rates, especially on first attempts.

**Poor:** "add tests for foo.py"

**Good:** "write a new test case for foo.py, covering the edge case where the user is logged out. avoid mocks"

### B. Give Claude Images

Claude excels with visual inputs:

- Paste screenshots (macOS: cmd+ctrl+shift+4 to clipboard)
- Drag and drop images directly into prompts
- Provide file paths for images

Particularly useful for design mocks and visual debugging.

### C. Mention Files to Work On

Use tab-completion to reference files and folders, helping Claude locate resources.

### D. Give Claude URLs

Paste URLs alongside prompts for Claude to fetch and read. Use `/permissions` to allowlist domains and avoid repeated permission prompts.

### E. Course Correct Early and Often

While auto-accept mode exists, active collaboration yields better results:

- **Ask Claude to plan** before coding (confirm before proceeding)
- **Press Escape** to interrupt any phase, preserving context
- **Double-tap Escape** to jump back in history and explore alternatives
- **Ask Claude to undo** changes when taking different approaches

These tools enable rapid refinement without losing context.

### F. Use `/clear` for Focused Context

During long sessions, irrelevant conversation fills the context window. Use `/clear` frequently between tasks to maintain performance.

### G. Use Checklists for Complex Workflows

For large tasks with multiple steps (migrations, lint fixes, complex builds), have Claude use Markdown files or GitHub issues as checklists:

1. Run commands and write results to a Markdown checklist
2. Address each item sequentially, verifying before checking off

### H. Pass Data Into Claude

Multiple input methods exist:

- Copy and paste directly into prompts
- Pipe into Claude Code (e.g., `cat foo.txt | claude`)
- Ask Claude to pull data via bash, MCP, or custom commands
- Request file or URL reads (works for images)

---

## 5. Headless Mode for Infrastructure Automation

Claude Code includes headless mode (`-p` flag) for non-interactive CI, pre-commit hooks, and build scripts. Use `--output-format stream-json` for streaming JSON output.

### A. Issue Triage Automation

Trigger Claude automatically on new GitHub issues to assign labels and categorize problems.

### B. Subjective Code Review

Claude provides reviews beyond traditional linting, identifying typos, stale comments, misleading names, and other issues.

---

## 6. Multi-Claude Workflows

### A. One Claude Writes, Another Verifies

Separate context across instances improves results:

1. Use Claude to write code
2. Run `/clear` or start a second Claude instance
3. Have the second Claude review or test
4. Start another Claude to edit based on feedback

### B. Multiple Repository Checkouts

Create 3-4 git checkouts in separate folders, launch Claude in each terminal, cycling through to approve requests. This enables parallel work.

### C. Git Worktrees

A lighter-weight alternative to multiple checkouts:

```bash
git worktree add ../project-feature-a feature-a
cd ../project-feature-a && claude
```

Run isolated tasks in separate worktrees simultaneously without merge conflicts.

Tips:

- Use consistent naming conventions
- Maintain one terminal tab per worktree
- Enable iTerm2 notifications for attention requests (macOS)
- Use separate IDE windows for different worktrees
- Clean up when finished: `git worktree remove ../project-feature-a`

### D. Headless Mode with Custom Harness

Two primary patterns:

**1. Fanning Out** (large migrations, batch analysis):

- Have Claude generate a task list
- Loop through tasks, calling Claude for each
- Example: migrate 2,000 files from framework A to B

**2. Pipelining** (integrate into existing workflows):

- Call `claude -p "<prompt>" --json | your_command`
- Use `--verbose` flag for debugging (disable in production)

---

## Key Takeaways

Nothing in this list is set in stone nor universally applicable; consider these suggestions as starting points. Successful Claude Code usage requires:

1. **Customization** through CLAUDE.md files and tool allowlisting
2. **Strategic tool integration** via bash, MCP, and custom commands
3. **Deliberate workflow selection** matching problem requirements
4. **Active collaboration** with course correction and iteration
5. **Multi-instance coordination** for complex tasks

The underlying philosophy treats Claude Code as a flexible power tool—powerful precisely because it remains unopinionated about workflows and customizable to individual preferences.
