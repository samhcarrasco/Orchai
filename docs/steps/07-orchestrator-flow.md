# Step 07: Orchestrator Flow

## Goal

Wire the planner, builder, reviewer, and logger together into one full run.

This is the step where the prototype starts to feel like an actual system.

## Teacher Explanation

The orchestrator answers this question:

What happens next?

The agents do specialized work. The orchestrator controls the order:

1. Receive the prompt.
2. Ask the planner for tasks.
3. Create project state.
4. Ask the builder to write files.
5. Ask the reviewer to check the files.
6. Save logs.
7. Print a final summary.

The agents should not call each other directly. That keeps the workflow easier to understand.

## What We Will Update

When we work on this step, we will update:

```txt
src/orchestrator.ts
src/index.ts
```

## Final Flow

```txt
User prompt
  -> Orchestrator
  -> Planner Agent
  -> Project State
  -> Builder Agent
  -> Reviewer Agent
  -> Logs and summary
```

## Final CLI Output Should Include

- run id
- project path
- workspace kind
- number of tasks
- review result
- log path

## Implementation Tasks

1. Create a `runId`.
2. Create a `UserRequest`.
3. Create a logger.
4. Call the planner.
5. Create `ProjectState`.
6. Call the builder.
7. Call the reviewer.
8. Save the log.
9. Print a summary.

## Acceptance Criteria

This step is complete when:

- One command runs the full workflow.
- A generated project appears in the external generated root.
- A run log appears in the external runs root.
- The final terminal output clearly says whether review passed.

## Check Before Moving On

Ask yourself:

- Which file controls the workflow order?
- Do any agents call each other directly?
- Can I follow the run by reading the log?

## Common Mistakes

- Putting all logic in the orchestrator.
- Letting agents control the workflow.
- Forgetting to update project state after each agent runs.
