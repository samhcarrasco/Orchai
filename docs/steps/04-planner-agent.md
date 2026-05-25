# Step 04: Planner Agent

## Goal

Create a planner agent that turns a user idea into structured tasks.

For the first version, the planner will be deterministic. That means it will use normal TypeScript logic, not a real AI API yet.

## Teacher Explanation

The planner answers this question:

What needs to be done?

If the user says:

```txt
Build a simple todo app
```

the planner should break that into smaller tasks:

- create HTML
- add CSS
- add JavaScript behavior

The important idea is that the planner does not write files. It only creates a plan.

## What We Will Create

When we work on this step, we will create:

```txt
src/agents/
  plannerAgent.ts
```

## Planner Input

```ts
{
  request: UserRequest;
}
```

## Planner Output

```ts
{
  projectName: string;
  tasks: Task[];
}
```

## Example Output

```json
{
  "projectName": "simple-todo-app",
  "tasks": [
    {
      "id": "task_001",
      "title": "Create HTML page",
      "description": "Create an index.html file with a todo input, button, and list.",
      "targetFiles": ["index.html"],
      "status": "pending"
    }
  ]
}
```

## Implementation Tasks

1. Create `PlannerAgent`.
2. Give it a method like `plan(input)`.
3. If the prompt contains `todo`, return todo app tasks.
4. Otherwise, return a generic static site plan.
5. Log planner start and completion.

## Acceptance Criteria

This step is complete when:

- The planner returns a project name.
- The planner returns at least two tasks.
- Each task has an id, title, description, target files, and status.
- Planner activity appears in the run log.

## Check Before Moving On

Ask yourself:

- Why does the planner return tasks instead of files?
- Could a different builder use the same planner output?
- What would make the planner output hard for another agent to use?

## Common Mistakes

- Letting the planner write files.
- Returning vague text instead of structured tasks.
- Making the planner too clever before the workflow is clear.
