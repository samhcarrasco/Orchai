# Step 03: Logger

## Goal

Create a simple logger that records what happened during each run.

The logger will save a readable JSON file outside the Orchestra source repo.

## Teacher Explanation

Agent systems can become hard to understand because work happens in stages.

The user gives a prompt. The planner makes tasks. The builder writes files. The reviewer checks the result. If something goes wrong, you need to know where it went wrong.

The logger is the system's flight recorder. It gives us a timeline.

## What We Will Create

When we work on this step, we will create:

```txt
src/core/
  logger.ts
```

## What The Logger Should Record

Each log entry should include:

- timestamp
- run id
- agent name
- event name
- optional input
- optional output

## Example Log Entry

```json
{
  "timestamp": "2026-05-21T19:48:12.000Z",
  "runId": "run_001",
  "agent": "planner",
  "event": "planner.completed",
  "input": {
    "prompt": "Build a simple todo app"
  },
  "output": {
    "projectName": "simple-todo-app",
    "tasks": []
  }
}
```

## Why This Matters

Logs make invisible work visible.

When you are learning orchestration, logs are not optional. They are how you inspect the system's thinking and behavior.

## Implementation Tasks

1. Create a `RunLogger` class.
2. Store log entries in memory during a run.
3. Add a `log()` method.
4. Add a `save()` method that writes JSON to an external runs folder.
5. Add orchestrator start and finish logs.

## Acceptance Criteria

This step is complete when:

- Running the program creates a JSON log file.
- The log includes `orchestrator.started`.
- The log includes `orchestrator.completed`.

## Check Before Moving On

Ask yourself:

- Can I open a run log and understand what happened?
- Does every log entry have a timestamp?
- Does the log file name match the run id?
- Is the log saved outside the Orchestra source repo?

## Common Mistakes

- Only logging final results.
- Logging huge unclear text blobs instead of structured JSON.
- Forgetting to save logs when a run fails.
