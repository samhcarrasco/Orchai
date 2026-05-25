# Step 01: Project Setup

## Goal

Create the smallest TypeScript project that can run from the command line.

We are not building agents yet. This step is only about making sure the project can start, read a user prompt, and print something back.

## Teacher Explanation

Every system needs a front door. For this prototype, the front door is the command line.

When you type something like:

```bash
npm run dev -- "Build a todo app"
```

the text after `--` becomes the user's request. Later, that request will flow through the orchestrator, planner, builder, and reviewer. For now, we only prove that we can receive the prompt.

Think of this step as turning on the lights before arranging the workshop.

## What We Will Create

When we work on this step, we will create:

```txt
package.json
tsconfig.json
src/
  index.ts
  orchestrator.ts
```

## What Each File Is For

`package.json`

Holds project scripts and development dependencies.

`tsconfig.json`

Tells TypeScript how to check the code.

`src/index.ts`

The command-line entry point. It reads the user's prompt.

`src/orchestrator.ts`

The future home of the workflow controller. In this step, it will only print the prompt.

## Implementation Tasks

1. Initialize a Node project.
2. Install TypeScript and `tsx`.
3. Add a `dev` script.
4. Create `src/index.ts`.
5. Create a tiny `runOrchestrator` function.
6. Run the project from the command line.

## Acceptance Criteria

This step is complete when:

- `npm run dev -- "hello"` works.
- The program prints the prompt.
- The project has no TypeScript errors.

## Check Before Moving On

Ask yourself:

- Can I explain what `src/index.ts` does?
- Can I explain why the orchestrator is separate from the CLI file?
- Can I run the project without errors?

## Common Mistakes

- Forgetting the `--` before the prompt.
- Putting orchestration logic directly in `index.ts`.
- Trying to build all agents before the basic command-line flow works.
