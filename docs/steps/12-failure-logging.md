# Step 12: Failure Logging

## Goal

Save a useful run log even when an agent or worker fails.

## Teacher Explanation

Agent workflows fail in stages.

A planner might return invalid JSON. A worker might fail. A reviewer command might crash. If the process only prints a stack trace, you lose the timeline that explains what happened before the failure.

Failure logging keeps the run inspectable.

## Flow

```txt
orchestrator.started
planner.started
...
orchestrator.failed
```

The failure entry should include:

- error name
- error message
- stack trace

## CLI Behavior

The terminal should show a short failure summary:

```txt
Run failed
Error: ...
Log path: ...
```

The stack trace should live in the JSON log, not flood the terminal by default.

## Acceptance Criteria

This step is complete when:

- agent or worker errors create `orchestrator.failed`
- the failed run log is saved
- the CLI prints the failed run's log path
- normal successful runs still work
