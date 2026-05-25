# Step 10: Future Improvements

## Goal

List useful upgrades to consider only after the basic version works.

This step protects the project from growing too fast.

## Teacher Explanation

The hard part of beginner architecture is not finding more features. It is choosing what not to build yet.

The first version should teach you the core loop:

```txt
plan -> build -> review -> log
```

Once that loop feels clear, then upgrades become easier to reason about.

## Good Future Upgrades

Add these later, one at a time:

- existing repo mode for continuing work inside a real codebase
- schema validation with Zod
- retry logic for failed agent outputs
- a second builder pass after reviewer feedback
- human approval before writing files
- support for editing existing generated projects
- richer logs with durations
- a simple web UI
- real LLM planner support

## Primary Long-Term Use Case

Orchestra should not become one app maker and a separate codebase editor. It should be one orchestration system that can create new work or continue existing work depending on the workspace target.

The generated project flow is useful for learning the orchestration loop, but the primary long-term use case is helping workers continue work inside existing codebases.

That means Orchestra should eventually support one core loop with different workspace targets:

```txt
new generated workspace
  -> write into ORCHESTRA_GENERATED_ROOT
  -> never write generated output into the Orchestra source repo

existing repo workspace
  -> work inside a repo the user chooses
  -> read existing files and project structure
  -> understand current work through git status and diffs
  -> make targeted edits inside that repo
  -> run that repo's checks or tests
  -> log what changed and why
```

The same agents should still be responsible for the same parts of the workflow:

```txt
planner
  -> decides what should happen

builder/worker
  -> creates or edits files in the selected workspace

reviewer
  -> checks the result in that same workspace

orchestrator
  -> coordinates the whole run
```

The difference should be the selected workspace, not a separate product:

```ts
type WorkspaceTarget =
  | { kind: "new-generated-project"; rootPath: string; projectName: string }
  | { kind: "existing-repo"; rootPath: string };
```

Existing repo work should have stronger guardrails than new generated work because it operates on code the user may already care about.

Important safety rules:

- The user must choose the target repo path.
- Writes must stay inside the chosen repo.
- Generated outputs and run logs must stay outside the Orchestra source repo.
- Orchestra should inspect `git status` before editing.
- Orchestra should not overwrite or revert unrelated existing changes.
- Changes should be visible through diffs.
- The run log should record changed files, commands run, and test results.

When the workspace target is an existing repo, planner tasks should refer to existing project files when appropriate:

```txt
Update src/components/LoginForm.tsx
Add or update tests for the changed behavior
Run npm test
```

This also fits the future terminal AI client direction well. Orchestra can run a logged-in local AI CLI from inside the selected workspace, capture the result, inspect diffs and tests, then continue coordinating the workflow.

## Existing Repo First Version

The first existing repo version should keep the same loop:

```txt
prompt
  -> planner
  -> builder/worker
  -> reviewer
  -> logger
```

But the workspace target can be selected with:

```powershell
$env:ORCHESTRA_WORKSPACE_PATH = "C:\path\to\repo"
```

In this version, existing repo work should require a Claude workspace worker because the deterministic template builder is only useful for generated projects. Claude planning can remain optional.

Guardrails:

- Require the workspace path to be a git repo.
- Refuse to run on a dirty repo by default.
- Allow dirty repos only with an explicit opt-in.
- Record git status before and after the worker.
- Keep generated project mode as the default.

## Bigger Infrastructure To Delay

Avoid these until the local prototype is useful:

- queues
- databases
- Docker
- cloud deployment
- many specialized agents
- complex agent frameworks

These tools can be useful later, but they will distract from learning the orchestration loop right now.

## Implementation Tasks Later

1. Pick one improvement.
2. Write down why it is needed.
3. Add the smallest version of it.
4. Test one happy path.
5. Test one failure path.
6. Update the docs.

## Acceptance Criteria Later

This future step is complete when:

- You can explain what problem the upgrade solves.
- The basic workflow still works.
- Logs still make the system understandable.
- The upgrade does not require rewriting everything.

## Check Before Moving On Later

Ask yourself:

- Am I solving a real problem I already observed?
- Is this upgrade making the system easier to use or just more impressive?
- Can I remove this upgrade without breaking the core idea?

## Common Mistakes

- Adding too many agents.
- Adding infrastructure before the local version works.
- Chasing a polished platform before building a clear prototype.
