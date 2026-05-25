# Step 02: Core Types

## Goal

Define the shared data shapes that all parts of the system will use.

This is where we describe things like tasks, project files, logs, and review results.

## Teacher Explanation

Agents need contracts.

Without shared types, one agent might return a field called `taskName` while another expects `title`. That creates confusion fast. Types give every part of the system a common language.

In this project, TypeScript types are like labeled containers. They do not do the work themselves, but they help us pass information around safely.

## What We Will Create

When we work on this step, we will create:

```txt
src/core/
  types.ts
```

## Important Data Structures

We will define:

- `UserRequest`
- `Task`
- `ProjectFile`
- `ProjectState`
- `AgentLogEntry`
- `PlannerOutput`
- `BuilderOutput`
- `ReviewResult`

## Example Task Shape

```ts
export interface Task {
  id: string;
  title: string;
  description: string;
  targetFiles: string[];
  status: "pending" | "in_progress" | "done" | "failed";
}
```

## Why This Matters

The orchestrator will pass data between agents.

The planner returns tasks. The builder reads those tasks. The reviewer checks whether those tasks produced good files. If the shapes are clear, the system is easier to debug.

## Implementation Tasks

1. Create `src/core/types.ts`.
2. Add the shared interfaces.
3. Import at least one type somewhere else to confirm it works.
4. Run TypeScript checking.

## Acceptance Criteria

This step is complete when:

- `types.ts` contains the shared interfaces.
- Other files can import these types.
- TypeScript finds no errors.

## Check Before Moving On

Ask yourself:

- What is the difference between a `Task` and a `ProjectFile`?
- Why does `ProjectState` need to know about tasks and files?
- What does a review result need to include?

## Common Mistakes

- Using plain `any` everywhere.
- Letting every agent invent its own data format.
- Adding too many fields before we know we need them.
