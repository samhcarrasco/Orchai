# Step 05: Builder Agent

## Goal

Create a builder agent that turns planned tasks into project files.

The builder writes files into the selected workspace. For generated projects, that workspace is `ORCHESTRA_GENERATED_ROOT` or the default external Orchestra projects folder.

## Teacher Explanation

The builder answers this question:

How do we create the thing?

The planner says what needs to exist. The builder creates the files. This separation matters because it keeps responsibilities clear.

In the first version, the builder will use simple templates. Later, it could use an LLM to write more flexible code.

This should stay part of one Orchestra workflow. The builder is not only an app generator. It is the file-writing worker for the selected workspace. In generated project mode, that workspace must be outside the Orchestra source repo. In existing repo mode, the selected workspace is the repo path the user chose.

## What We Will Create

When we work on this step, we will create:

```txt
src/agents/
  builderAgent.ts
src/core/
  fileSystem.ts
```

Generated output must not live inside the Orchestra source repo. Use:

```txt
ORCHESTRA_GENERATED_ROOT
```

or the default external Orchestra projects folder.

## Builder Input

```ts
{
  projectState: ProjectState;
  tasks: Task[];
}
```

## Builder Output

```ts
{
  filesChanged: ProjectFile[];
  notes: string;
}
```

## What The Builder Should Do

For a todo app, it should create:

```txt
<generated-root>/simple-todo-app/
  index.html
  styles.css
  app.js
```

## Why File Safety Matters

The builder writes to disk, so it needs guardrails.

It should only write inside the selected workspace folder. It should not be able to write random files elsewhere on your computer.

Later, when Orchestra supports existing repos, the same safety idea should apply to the selected repo root. The allowed write folder changes, but the rule stays the same: only write inside the workspace the user chose.

## Implementation Tasks

1. Create a file system helper.
2. Create a safe project root path.
3. Add a check that prevents writing outside the project root.
4. Create `BuilderAgent`.
5. Convert task target files into actual file contents.
6. Write the files.
7. Log builder start and completion.

## Acceptance Criteria

This step is complete when:

- A todo prompt creates `index.html`, `styles.css`, and `app.js`.
- Files are created under the external generated root.
- The builder returns a list of changed files.
- Builder activity appears in the run log.

## Check Before Moving On

Ask yourself:

- Why does the builder receive tasks instead of the original prompt only?
- What folder is the builder allowed to write into?
- What should happen if the planner asks for a strange file path?

## Common Mistakes

- Letting the builder write anywhere on disk.
- Mixing planner decisions into builder code.
- Forgetting to return which files changed.
