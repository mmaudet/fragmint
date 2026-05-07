# Claude 4 Best Practices

> Source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices

## General Principles

### Be Explicit
Claude 4.x models respond well to clear, explicit instructions. Be specific about desired output.

```
# Less effective
Create an analytics dashboard

# More effective
Create an analytics dashboard. Include as many relevant features and interactions as possible. Go beyond the basics to create a fully-featured implementation.
```

### Add Context
Explain WHY you want certain behavior - Claude generalizes from explanations.

```
# Less effective
NEVER use ellipses

# More effective
Your response will be read aloud by a text-to-speech engine, so never use ellipses since the text-to-speech engine will not know how to pronounce them.
```

### Be Vigilant with Examples
Claude pays close attention to details and examples. Ensure examples align with desired behaviors.

## Multi-Context Window Workflows

### First Context Window
Use it to set up framework (write tests, create setup scripts), then iterate on todo-list in future windows.

### Structured Test Format
```json
{
  "tests": [
    {"id": 1, "name": "authentication_flow", "status": "passing"},
    {"id": 2, "name": "user_management", "status": "failing"}
  ]
}
```
> "It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality."

### Setup Scripts
Create `init.sh` to gracefully start servers, run test suites, and linters. Prevents repeated work.

### Starting Fresh
Claude 4.5 models are extremely effective at discovering state from the local filesystem. Be prescriptive:
- "Call pwd; you can only read and write files in this directory."
- "Review progress.txt, tests.json, and the git logs."
- "Manually run through a fundamental integration test before implementing new features."

### Context Management Prompt
```
Your context window will be automatically compacted as it approaches its limit, allowing you to continue working indefinitely. Do not stop tasks early due to token budget concerns. Save your current progress and state to memory before the context window refreshes. Always be as persistent and autonomous as possible and complete tasks fully.
```

## State Management Best Practices

- **Structured formats for state data**: JSON for test results, task status
- **Unstructured text for progress notes**: Freeform notes for general progress
- **Git for state tracking**: Log of what's been done + checkpoints to restore
- **Incremental progress**: Explicitly ask Claude to track progress and focus on incremental work

## Tool Usage Patterns

### Be Explicit About Actions
```
# Less effective (Claude will only suggest)
Can you suggest some changes to improve this function?

# More effective (Claude will make changes)
Change this function to improve its performance.
```

### Proactive Action Prompt
```
By default, implement changes rather than only suggesting them. If the user's intent is unclear, infer the most useful likely action and proceed, using tools to discover any missing details instead of guessing.
```

## Parallel Tool Calling

Claude 4.x excels at parallel execution. Boost to ~100% success:

```
If you intend to call multiple tools and there are no dependencies between the calls, make all independent calls in parallel. Prioritize calling tools simultaneously whenever possible. However, if some tool calls depend on previous calls, do NOT call these tools in parallel.
```

## Avoid Over-Engineering

```
Avoid over-engineering. Only make changes that are directly requested or clearly necessary. Keep solutions simple and focused.

Don't add features, refactor code, or make "improvements" beyond what was asked. A bug fix doesn't need surrounding code cleaned up. A simple feature doesn't need extra configurability.

Don't create helpers, utilities, or abstractions for one-time operations. Don't design for hypothetical future requirements. The right amount of complexity is the minimum needed for the current task.
```

## Code Exploration

```
ALWAYS read and understand relevant files before proposing code edits. Do not speculate about code you have not inspected. If the user references a specific file/path, you MUST open and inspect it before explaining or proposing fixes. Be rigorous and persistent in searching code for key facts.
```

## Minimize Hallucinations

```
Never speculate about code you have not opened. If the user references a specific file, you MUST read the file before answering. Make sure to investigate and read relevant files BEFORE answering questions about the codebase. Never make any claims about code before investigating.
```

## Key Capabilities

- **Long-horizon reasoning**: Maintains orientation across extended sessions
- **State tracking**: Exceptional at tracking state across multiple context windows
- **Parallel execution**: Aggressive parallel tool calling for efficiency
- **Subagent orchestration**: Recognizes when to delegate to specialized subagents
- **Vision**: Improved image processing and data extraction
