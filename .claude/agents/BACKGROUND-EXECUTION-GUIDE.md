# Background Agent Execution - Quick Reference

Guide for when and how to run agents in background vs blocking mode.

## Quick Decision Tree

```
Need results immediately?
  ├─ Yes → BLOCKING
  └─ No → Continue...

Running multiple agents?
  ├─ Yes → BACKGROUND (parallel)
  └─ No → Continue...

Agent takes > 30 seconds?
  ├─ Yes → BACKGROUND
  └─ No → BLOCKING
```

## Execution Patterns

### Pattern 1: Single Blocking Agent (Simple)

**When**: Quick analysis, need results immediately

**Code**:
```
Task tool:
  - subagent_type: "system-review"
  - prompt: "Review X against Y"
  - run_in_background: false (or omit - false is default)

[Main agent waits]
[Receives result]
[Acts on result]
```

**Timing**:
```
t=0s   Launch agent
t=45s  Agent completes
t=45s  Main agent receives result
t=45s  Main agent processes result
Total: 45s
```

**Use for**:
- Single agent workflows
- Fast agents (< 30s)
- Results needed for next step

### Pattern 2: Multiple Blocking Agents (Sequential)

**When**: Need results from each before starting next

**Code**:
```
Task tool → Agent 1 → Wait → Result 1
Task tool → Agent 2 → Wait → Result 2
Task tool → Agent 3 → Wait → Result 3
Process all results
```

**Timing**:
```
t=0s   Agent 1 launches
t=30s  Agent 1 done, Agent 2 launches
t=60s  Agent 2 done, Agent 3 launches
t=90s  Agent 3 done
Total: 90s
```

**Use for**:
- Results of Agent 1 needed for Agent 2
- Sequential dependencies
- Simple workflows

### Pattern 3: Multiple Background Agents (Parallel)

**When**: Multiple analyses, no dependencies

**Code**:
```
Send single message with multiple Task calls:

Task tool (background):
  - subagent_type: "code-review"
  - run_in_background: true
  → task_id_1

Task tool (background):
  - subagent_type: "security-review"
  - run_in_background: true
  → task_id_2

Task tool (background):
  - subagent_type: "performance-review"
  - run_in_background: true
  → task_id_3

[Main agent continues working]

TaskOutput:
  - task_id: task_id_1
  - block: true

TaskOutput:
  - task_id: task_id_2
  - block: true

TaskOutput:
  - task_id: task_id_3
  - block: true

[Process all results]
```

**Timing**:
```
t=0s   All 3 agents launch (parallel)
t=0s   Main agent continues working
t=30s  Agent 2 completes
t=45s  Agent 1 completes
t=60s  Agent 3 completes
t=60s  Main agent retrieves all results
Total: 60s (vs 135s sequential!)
```

**Use for**:
- Multiple independent analyses
- Time-consuming agents
- Want to do other work while they run

### Pattern 4: Hybrid (Background + Continue + Retrieve)

**When**: Launch agents, do other work, retrieve when ready

**Code**:
```
# Launch agents in background
Task → task_id_1
Task → task_id_2
Task → task_id_3

# Do other work while they run
Run tests
Run linting
Check git status

# Retrieve agent results when ready
TaskOutput → result_1
TaskOutput → result_2
TaskOutput → result_3

# Combine everything
Aggregate findings
Generate report
```

**Timing**:
```
t=0s   Launch 3 agents (background)
t=0s   Start automated checks
t=20s  Automated checks done
t=20s  Wait for agents (if not done)
t=60s  All agents done
t=60s  Aggregate results
Total: 60s

Time saved: Tests didn't add time because they ran while agents worked!
```

**Use for**:
- Validation pipelines
- Multiple types of checks (agents + automated)
- Maximum efficiency

### Pattern 5: Progressive Results (Advanced)

**When**: Show results as they complete

**Code**:
```
# Launch all agents in background
task_ids = [Launch 5 agents]

# Poll for completion
while any_agent_running:
  for task_id in task_ids:
    result = TaskOutput(task_id, block=false)
    if result.complete:
      Show result to user
      Remove from tracking

  Do other work

# All complete
Aggregate final results
```

**Timing**:
```
t=0s   Launch 5 agents
t=15s  Agent 1 done → Show results
t=30s  Agent 3 done → Show results
t=45s  Agent 2 done → Show results
t=50s  Agent 4 done → Show results
t=60s  Agent 5 done → Show results
t=60s  Final aggregation
Total: 60s (but user sees progress throughout!)
```

**Use for**:
- Long-running analyses
- User experience during complex workflows
- Progress visibility

## Real-World Examples

### Example 1: Post-Implementation Review (Blocking)

```
Scenario: Just finished implementation, need review before moving on

Code:
  Task(system-review, plan + report)
  [Wait]
  [Process findings]
  [Present to user]

Why blocking: Need to discuss findings before next task
Time: 45s total
```

### Example 2: Parallel Codebase Research (Background)

```
Scenario: Research authentication patterns

Code:
  Task(explore auth implementation, background) → id_1
  Task(explore token handling, background) → id_2
  Task(explore session mgmt, background) → id_3
  Task(explore middleware, background) → id_4
  Task(explore tests, background) → id_5

  [All launch immediately]
  [Main agent tells user what's happening]

  TaskOutput(id_1) → result_1
  TaskOutput(id_2) → result_2
  ...

  [Combine all findings]

Why background: 5 agents in parallel, 5x speedup
Time: 60s total (vs 300s sequential)
```

### Example 3: Pre-Commit Validation (Hybrid)

```
Scenario: Full validation before commit

Code:
  # Background agents
  Task(code-review, background) → id_1
  Task(security-review, background) → id_2

  # Automated checks while agents run
  Run tests (20s)
  Run linting (10s)
  Run type check (15s)

  # Retrieve agent results
  TaskOutput(id_1) → code_review
  TaskOutput(id_2) → security_review

  # Aggregate
  Combine all findings
  Present summary

Why hybrid: Agents + automated both needed, maximize parallelism
Time: 60s (agent time) vs 105s (sequential) = 43% faster
```

### Example 4: Creating New Agent (Blocking)

```
Scenario: User wants to create custom agent

Code:
  Task(meta-agent, "create security agent")
  [Wait]
  [Receive agent file]
  [Save to disk]
  [Explain usage to user]

Why blocking: Need agent file before continuing
Time: 30s total
```

### Example 5: Comprehensive Audit (Background)

```
Scenario: Full codebase audit, don't block user

Code:
  # Launch 10 agents in background
  Task(code-review module-1, background) → id_1
  Task(code-review module-2, background) → id_2
  ...
  Task(code-review module-10, background) → id_10

  [Tell user: "Audit running in background, will take ~10 min"]
  [User continues working]

  # Later, retrieve results
  for id in ids:
    results.append(TaskOutput(id))

  [Aggregate]
  [Notify user]

Why background: Long-running, user doesn't need results immediately
Time: 10 minutes, but user isn't blocked
```

## TaskOutput Options

### Blocking (Wait for Completion)

```
TaskOutput:
  - task_id: "abc123"
  - block: true (default)
  - timeout: 30000 (30s default, up to 600000ms)

Returns: Agent output or timeout error
```

**Use when**: You need results now

### Non-Blocking (Check Status)

```
TaskOutput:
  - task_id: "abc123"
  - block: false
  - timeout: 0

Returns:
  - Result if done
  - Status "running" if not done
```

**Use when**: Polling for completion, doing other work

## Best Practices

### DO ✅

1. **Launch multiple agents in single message**
   ```
   One message with 5 Task calls = truly parallel
   ```

2. **Track task IDs**
   ```
   Store IDs to retrieve results later
   ```

3. **Set user expectations**
   ```
   Tell user: "Launched 5 agents, will take ~60s"
   ```

4. **Use appropriate timeouts**
   ```
   Quick agents: 30s timeout
   Deep analysis: 120s timeout
   Full audit: 300s timeout
   ```

5. **Handle errors gracefully**
   ```
   If agent fails, continue with others
   Report failure in summary
   ```

6. **Aggregate intelligently**
   ```
   Group similar findings
   Sort by severity
   Remove duplicates
   ```

### DON'T ❌

1. **Don't use background for fast agents**
   ```
   Agent takes 5s → Blocking is simpler
   ```

2. **Don't forget to retrieve results**
   ```
   Launched background agent but never call TaskOutput = wasted work
   ```

3. **Don't block user unnecessarily**
   ```
   3-minute analysis → Use background, let user continue working
   ```

4. **Don't launch too many at once**
   ```
   Limit: 10 concurrent agents (system constraint)
   ```

5. **Don't use background with dependencies**
   ```
   Agent B needs Agent A's result → Use sequential blocking
   ```

6. **Don't assume instant completion**
   ```
   TaskOutput with block=false may return "running"
   ```

## Performance Comparison

### Scenario: 5 Analysis Tasks

**Sequential Blocking**:
```
Agent 1: 30s
Agent 2: 45s
Agent 3: 60s
Agent 4: 30s
Agent 5: 45s
Total: 210s
```

**Parallel Background**:
```
All launch: t=0
Agent 1 done: t=30
Agent 2 done: t=45
Agent 4 done: t=30
Agent 5 done: t=45
Agent 3 done: t=60 (slowest)
Total: 60s (71% faster!)
```

**Hybrid (with automated checks)**:
```
Launch agents: t=0
Run tests: 0-20s
Run linting: 0-15s
Agents done: t=60
Total: 60s (tests/linting "free"!)
```

## Common Mistakes

### Mistake 1: Sequential Task Calls

```
❌ Wrong:
Message 1: Task(agent-1)
[Wait for response]
Message 2: Task(agent-2)
[Wait for response]
Result: Sequential execution

✅ Right:
Message 1:
  Task(agent-1, background)
  Task(agent-2, background)
Result: Parallel execution
```

### Mistake 2: Forgetting to Retrieve

```
❌ Wrong:
Task(agent, background) → id
[Do other work]
[Never call TaskOutput]
Result: Wasted agent execution

✅ Right:
Task(agent, background) → id
[Do other work]
TaskOutput(id) → result
[Use result]
```

### Mistake 3: Wrong Block Mode

```
❌ Wrong:
Launch 5 agents with block=true
Result: Sequential, not parallel

✅ Right:
Launch 5 agents with run_in_background=true
Then TaskOutput when ready
```

### Mistake 4: Timeout Too Short

```
❌ Wrong:
Launch deep analysis agent
TaskOutput(id, timeout=5000)
Result: Timeout before completion

✅ Right:
Launch deep analysis agent
TaskOutput(id, timeout=120000)
Result: Success
```

## Decision Matrix

| Scenario | Pattern | Reason |
|----------|---------|--------|
| Single quick analysis | Blocking | Simple, fast |
| Multiple independent analyses | Background parallel | Time savings |
| Sequential dependencies | Blocking sequential | Need results for next |
| Long audit + user continues | Background | Don't block user |
| Validation suite | Hybrid | Agents + automated |
| Creating artifacts | Blocking | Need file to proceed |
| Research 5+ topics | Background parallel | Maximum speed |
| Show progress during work | Background progressive | UX benefit |

## Monitoring

Track these metrics:

**Time Savings**:
```
Sequential time: 210s
Parallel time: 60s
Savings: 150s (71%)
```

**Resource Usage**:
```
Concurrent agents: 5
Peak memory: [track if issues]
Peak tokens: [track costs]
```

**Success Rate**:
```
Launched: 100 agents
Completed: 98 agents
Failed: 2 agents
Success rate: 98%
```

**User Experience**:
```
Wait time with blocking: 210s
Wait time with background: 60s
User satisfaction: ↑
```

## Summary

**Use Background Agents When**:
- ✅ Multiple analyses (parallel speedup)
- ✅ Time-consuming (> 30s)
- ✅ User can continue working
- ✅ Results not needed immediately

**Use Blocking Agents When**:
- ✅ Single agent
- ✅ Fast (< 30s)
- ✅ Need results for next step
- ✅ Simple workflow

**Use Hybrid When**:
- ✅ Agents + automated checks
- ✅ Want maximum efficiency
- ✅ Multiple types of validation

The key insight: **Background agents let you parallelize work and keep users unblocked**. Use them strategically for best performance and experience.
