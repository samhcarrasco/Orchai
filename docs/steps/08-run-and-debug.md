# Step 08: Run And Debug

## Goal

Practice running the system and inspecting what happened.

This step is about learning how to debug an agent workflow.

## Teacher Explanation

Building the system is only half the skill. The other half is understanding what happened when it ran.

For agent systems, you usually debug by looking at:

- the user prompt
- the planner output
- the builder output
- the reviewer output
- the final project files

The logs let you trace that story.

## What We Will Update

When we work on this step, we will create or update:

```txt
README.md
```

## What The README Should Explain

- how to install dependencies
- how to run the project
- where generated projects are saved
- where logs are saved
- how to set `ORCHESTRA_GENERATED_ROOT`
- how to set `ORCHESTRA_RUNS_ROOT`
- how to inspect a run manually

## Example Run Command

```bash
npm run dev -- "Build a simple todo app"
```

## Debugging Checklist

When a run finishes, check:

1. Did the terminal print a run id?
2. Did the printed project path contain a new project folder?
3. Did the printed log path contain a JSON log?
4. Did the planner create reasonable tasks?
5. Did the builder write the expected files?
6. Did the reviewer pass or explain why it failed?

## Implementation Tasks

1. Add README instructions.
2. Run a todo app prompt.
3. Open the generated files.
4. Open the run log.
5. Compare the log entries to the execution flow.

## Acceptance Criteria

This step is complete when:

- A beginner can follow the README and run the project.
- A beginner can find the generated project.
- A beginner can find and understand the log file.

## Check Before Moving On

Ask yourself:

- Can I explain the run from start to finish?
- Which log entry shows the planner output?
- Which log entry shows whether review passed?

## Common Mistakes

- Running commands without reading the output.
- Ignoring the log file.
- Changing several parts at once while debugging.
