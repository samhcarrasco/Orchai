# Orchai

Orchai is a TypeScript CLI for coordinating coding agents. Give it a prompt and it can plan the work, run Claude CLI workers, review the result, and save a JSON log of the whole run.

It has three useful modes:

- **Generated project mode** creates a fresh project in a new folder. This is the default and is safest for experimenting.
- **Existing repo mode** points a Claude worker at a repo you choose.
- **Parallel mode** splits independent work across multiple Claude workers using separate git worktrees.

The codebase still uses `ORCHESTRA_*` environment variables internally.

## Requirements

- Node.js 18 or newer
- Git, if you work in an existing repo or use parallel mode
- Claude CLI, installed and logged in, for existing repo mode, parallel mode, or `ORCHESTRA_PLANNER=claude`

You can try the default generated project mode without Claude because it uses the deterministic planner and template builder.

## Install

```bash
git clone https://github.com/samhcarrasco/Orchai.git
cd Orchai
npm install
npm run typecheck
```

## Quick Start

Run the commands below from the Orchai source directory, the folder that contains `package.json`. If you just installed Orchai, that is the folder you entered with `cd Orchai`.

Set the environment values first. This block includes every `ORCHESTRA_*` setup variable, with the values you can use and what each one changes.

```powershell
# Values: "deterministic" or "claude".
# Effect: selects how Orchai turns your prompt into tasks. Parallel mode requires "claude".
$env:ORCHESTRA_PLANNER = "deterministic"

# Values: "" for generated project mode, or a path to an existing git repo.
# Effect: blank creates a new generated project. A repo path tells Claude where to edit existing code.
$env:ORCHESTRA_WORKSPACE_PATH = ""

# Values: "0" or "1".
# Effect: "1" allows uncommitted changes in single-worker existing repo mode. Parallel mode ignores this and requires a clean repo.
$env:ORCHESTRA_ALLOW_DIRTY_REPO = "0"

# Values: any folder path outside this Orchai source repo.
# Effect: controls where generated projects are created.
$env:ORCHESTRA_GENERATED_ROOT = "$HOME\Desktop\Orchestra Projects"

# Values: any folder path outside this Orchai source repo.
# Effect: controls where JSON run logs are saved.
$env:ORCHESTRA_RUNS_ROOT = "$HOME\Documents\Orchestra\runs"

# Values: any folder path outside this Orchai source repo.
# Effect: controls where parallel mode creates worker git worktrees.
$env:ORCHESTRA_PARALLEL_WORKTREES_ROOT = "$HOME\Documents\Orchestra\worktrees"

# Values: "claude" or the full path to the Claude CLI executable.
# Effect: tells Orchai which Claude CLI command to run.
$env:ORCHESTRA_CLAUDE_COMMAND = "claude"

# Values: "" for the Claude CLI default, or a Claude model name accepted by your CLI.
# Effect: passes the model to the planner with claude --model.
$env:ORCHESTRA_PLANNER_MODEL = ""

# Values: "" for the Claude CLI default, or a Claude model name accepted by your CLI.
# Effect: passes the model to Claude workers that edit files.
$env:ORCHESTRA_WORKER_MODEL = ""

# Values: "" to use ORCHESTRA_WORKER_MODEL, or a Claude model name accepted by your CLI.
# Effect: chooses the model used when parallel mode resolves rebase conflicts.
$env:ORCHESTRA_CONFLICT_RESOLVER_MODEL = ""

# Values: "" to skip repo-specific checks, or any shell command such as "npm test" or "pnpm lint".
# Effect: runs this command inside the selected workspace after edits.
$env:ORCHESTRA_REVIEW_COMMAND = ""

# Values: any positive number of milliseconds.
# Effect: sets how long each parallel worker can run before timing out.
$env:ORCHESTRA_PARALLEL_WORKER_TIMEOUT_MS = "3600000"

# Values: any positive integer.
# Effect: sets how many times a parallel worker can retry after review feedback.
$env:ORCHESTRA_MAX_BUILD_ATTEMPTS = "3"

# Values: any git remote name, such as "origin" or "upstream".
# Effect: chooses the remote used when parallel mode fetches, rebases, and pushes worker branches.
$env:ORCHESTRA_GIT_REMOTE = "origin"
```

Then create a small project in a new folder:

```powershell
npm run dev -- "Build a simple todo app"
```

Generated projects are written here:

```txt
C:\Users\<you>\Desktop\Orchestra Projects\
```

Run logs are written here:

```txt
C:\Users\<you>\Documents\Orchestra\runs\
```

The terminal summary prints the project path and log path after each run.

## Generated Project Mode

Generated project mode is the default. Orchai creates a new project folder and does not edit any existing repo.

```powershell
npm run dev -- "Build a simple todo app"
```

Use a different output folder:

```powershell
$env:ORCHESTRA_GENERATED_ROOT = "C:\path\to\generated-projects"
npm run dev -- "Build a simple todo app"
```

Runtime folders must be outside this Orchai source repo.

## Existing Repo Mode

Use this when you want Claude to edit a real repo. Claude planning is recommended for real codebases, but the deterministic planner can still be used for a simple two-step plan.

Set the values in [Quick Start](#quick-start), then run:

```powershell
npm run dev -- "Add input validation to the login form"
```

What to know:

- `ORCHESTRA_WORKSPACE_PATH` must point to a git repo outside this Orchai source repo.
- The target repo must have a clean working tree by default.
- `ORCHESTRA_REVIEW_COMMAND` is optional. If set, it runs inside the target repo after Claude edits files.
- To allow existing uncommitted changes in single-worker existing repo mode, set `$env:ORCHESTRA_ALLOW_DIRTY_REPO = "1"`.

Return to generated project mode:

```powershell
Remove-Item Env:ORCHESTRA_WORKSPACE_PATH -ErrorAction SilentlyContinue
Remove-Item Env:ORCHESTRA_REVIEW_COMMAND -ErrorAction SilentlyContinue
$env:ORCHESTRA_PLANNER = "deterministic"
```

## Parallel Mode

Use parallel mode for batches of work that can be split into separate features. The planner decides whether the request should run as one worker, multiple workers, or be blocked because it is not safe to split.

Set the values in [Quick Start](#quick-start), then run:

```powershell
npm run dev -- --parallel "Refactor auth handling and add API rate limiting"
```

Example with three independent features:

```powershell
npm run dev -- --parallel "Add user profile avatars, add CSV export for reports, and add keyboard shortcuts to the dashboard"
```

Parallel mode:

- Requires a clean base repo. `ORCHESTRA_ALLOW_DIRTY_REPO` is ignored here.
- Creates one git worktree and one branch per worker.
- Opens a visible terminal window for each worker.
- Runs review for each worker.
- Commits successful worker changes and pushes branches to `origin` by default.
- Leaves worktrees in place so you can inspect them.

Default parallel worktree location:

```txt
C:\Users\<you>\Documents\Orchestra\worktrees\
```

## What The Output Means

A normal run ends with a summary like this:

```txt
Run complete
Run ID: run_...
Planner: claude
Workspace: existing-repo
Prompt: Add input validation to the login form
Project path: C:\path\to\your\repo
Tasks: 2
Files changed: 3
Review passed: true
Log path: C:\Users\...\Documents\Orchestra\runs\run_....json
```

A parallel run prints an aggregate log path plus one result block per worker. Each worker block includes the branch, worktree path, review result, commit, push result, Claude transcript, and cleanup command.

## Environment Variables

The [Quick Start](#quick-start) setup block lists every `ORCHESTRA_*` value. Use this section to decide what each one should be for your run.

Mode-specific notes:

- **Generated project mode:** leave `ORCHESTRA_WORKSPACE_PATH` blank or remove it so Orchai creates a new project instead of editing an existing repo.
- **Existing repo mode:** set `ORCHESTRA_WORKSPACE_PATH` to the git repo Claude should edit.
- **Parallel mode:** set `ORCHESTRA_PLANNER=claude` and `ORCHESTRA_WORKSPACE_PATH` to the base git repo.

What each variable does:

Planner and workspace:

- `ORCHESTRA_PLANNER`: `deterministic` or `claude`; defaults to `deterministic`. Selects the planner. Parallel mode requires `claude`; existing repo mode works best with it.
- `ORCHESTRA_WORKSPACE_PATH`: path to a git repo; no default. Turns on existing repo mode and tells Orchai which repo Claude should edit. Omit it for generated project mode.
- `ORCHESTRA_ALLOW_DIRTY_REPO`: `0` or `1`; defaults to `0`. Allows uncommitted changes in single-worker existing repo mode when set to `1`. Parallel mode ignores this and always requires a clean base repo.

Output paths:

- `ORCHESTRA_GENERATED_ROOT`: folder path; defaults to `C:\Users\<you>\Desktop\Orchestra Projects`. Chooses where generated projects are created.
- `ORCHESTRA_RUNS_ROOT`: folder path; defaults to `C:\Users\<you>\Documents\Orchestra\runs`. Chooses where JSON run logs are saved.
- `ORCHESTRA_PARALLEL_WORKTREES_ROOT`: folder path; defaults to `C:\Users\<you>\Documents\Orchestra\worktrees`. Chooses where parallel mode creates worker git worktrees.

Claude CLI:

- `ORCHESTRA_CLAUDE_COMMAND`: command or executable path; defaults to `claude`. Points Orchai at the Claude CLI binary. Use this if `claude` is not on your `PATH`.
- `ORCHESTRA_PLANNER_MODEL`: Claude model name; no default. Passes `--model` to the Claude planner. If omitted, Claude CLI uses its own default.
- `ORCHESTRA_WORKER_MODEL`: Claude model name; no default. Passes `--model` to Claude worker sessions that edit files.
- `ORCHESTRA_CONFLICT_RESOLVER_MODEL`: Claude model name; defaults to `ORCHESTRA_WORKER_MODEL`. Chooses the Claude model used when parallel mode asks a worker to resolve rebase conflicts.

Review and parallel behavior:

- `ORCHESTRA_REVIEW_COMMAND`: shell command; no default. Runs a repo-specific check after edits, such as `npm test`, `pnpm lint`, or `npm run mr-check`.
- `ORCHESTRA_PARALLEL_WORKER_TIMEOUT_MS`: positive number; defaults to `3600000`. Sets the timeout for each parallel worker in milliseconds.
- `ORCHESTRA_MAX_BUILD_ATTEMPTS`: positive integer; defaults to `3`. Sets how many times a parallel worker can retry after review feedback.
- `ORCHESTRA_GIT_REMOTE`: git remote name; defaults to `origin`. Chooses the remote used when parallel mode fetches, rebases, and pushes worker branches.

All generated roots, run-log roots, worktree roots, and existing repo paths must be outside this Orchai source repo.

## Debugging

If a run fails, the terminal prints the log path. Open that JSON file and look for these events:

```txt
orchestrator.started
planner.started
planner.completed
builder.started
builder.completed
reviewer.started
reviewer.completed
orchestrator.completed
orchestrator.failed
```

Parallel logs also include `parallel.*` events and one child log per worker.

Useful things to check:

- Did `planner.completed` create reasonable tasks?
- Did `builder.completed` list the files you expected?
- Did `reviewer.completed` pass?
- If a review command ran, what exit code did it return?
- If the run failed, what does `orchestrator.failed.output.error.message` say?

## Development

```bash
npm run typecheck
```
