# Orchestra

Orchestra is a small TypeScript prototype for learning how an agent workflow is coordinated.

The current workflow is:

```txt
prompt
  -> planner creates tasks
  -> builder/worker changes files
  -> reviewer checks files
  -> logger saves a JSON run record
  -> terminal prints a summary
```

The tool source directory should stay source-only. Generated projects, existing repo edits, and run logs must be written outside the Orchestra source repo.

## Install

```bash
npm install
```

## Run

Generated project mode is the default:

```bash
npm run dev -- "Build a simple todo app"
```

Expected terminal output looks like:

```txt
Run complete
Run ID: run_...
Planner: deterministic
Workspace: generated-project
Prompt: Build a simple todo app
Project path: C:\Users\...\Desktop\Orchestra Projects\simple-todo-app
Tasks: 3
Files changed: 3
Review passed: true
Log path: C:\Users\...\Documents\Orchestra\runs\run_....json
```

Generated projects are never written into the Orchestra source repo. By default they are written to your Desktop:

```txt
C:\Users\<you>\Desktop\Orchestra Projects\
```

You can choose a different external folder:

```powershell
$env:ORCHESTRA_GENERATED_ROOT = "C:\Users\shcar\Desktop\My Orchestra Projects"
npm run dev -- "Build a simple todo app"
```

`ORCHESTRA_GENERATED_ROOT` must be outside the Orchestra source repo.

## Planner Mode

By default, Orchestra uses the deterministic planner. That keeps local test runs predictable.

To use the local Claude CLI as the planner in PowerShell:

```powershell
$env:ORCHESTRA_PLANNER = "claude"
npm run dev -- "Build a simple todo app"
```

To switch back:

```powershell
$env:ORCHESTRA_PLANNER = "deterministic"
```

Claude mode uses the `claude` command already installed and logged in on the machine. You can override the command path with:

```powershell
$env:ORCHESTRA_CLAUDE_COMMAND = "C:\path\to\claude.exe"
```

Optional model tiers can be configured without hardcoding model names in Orchestra:

```powershell
$env:ORCHESTRA_PLANNER_MODEL = "haiku"
$env:ORCHESTRA_WORKER_MODEL = "sonnet"
$env:ORCHESTRA_CONFLICT_RESOLVER_MODEL = "opus"
```

These values are passed to Claude CLI as `--model` only when the environment variables are set.

## Existing Repo Mode

Orchestra can also target an existing git repo. This uses the same orchestration loop, but the workspace is the repo you choose instead of the generated projects folder.

PowerShell example:

```powershell
$env:ORCHESTRA_WORKSPACE_PATH = "C:\path\to\your\repo"
$env:ORCHESTRA_REVIEW_COMMAND = "npm run mr-check"
npm run dev -- "Add the requested feature"
```

Existing repo mode currently uses Claude as the workspace worker because the simple template builder is only appropriate for generated projects. The planner can still be deterministic, or you can opt into Claude planning too:

```powershell
$env:ORCHESTRA_PLANNER = "claude"
```

Safety rules in this first version:

- `ORCHESTRA_WORKSPACE_PATH` must point to a git repo.
- `ORCHESTRA_WORKSPACE_PATH` must be outside the Orchestra source repo.
- The Claude worker runs inside that repo.
- Orchestra refuses to work on a dirty repo by default.
- Set `$env:ORCHESTRA_ALLOW_DIRTY_REPO = "1"` only when you intentionally want to allow existing uncommitted changes.
- The run log records git status before and after the worker.
- `ORCHESTRA_REVIEW_COMMAND` is repo-specific and runs inside the selected repo after file changes.

Different repos can use different review commands:

```powershell
$env:ORCHESTRA_REVIEW_COMMAND = "npm run mr-check"
$env:ORCHESTRA_REVIEW_COMMAND = "npm test"
$env:ORCHESTRA_REVIEW_COMMAND = "pnpm lint"
```

If no review command is set, Orchestra still reviews changed files, but it does not run repo-specific tests or checks.

To return to generated project mode:

```powershell
Remove-Item Env:ORCHESTRA_WORKSPACE_PATH
Remove-Item Env:ORCHESTRA_REVIEW_COMMAND
$env:ORCHESTRA_PLANNER = "deterministic"
```

## Parallel Mode

Parallel mode uses a cheap scout/planner decision before any worker terminals start. The planner chooses `single_worker`, `parallel`, or `blocked`; small or tightly related requests run as one worker, and multiple workers are only started for meaningfully independent work.

```powershell
$env:ORCHESTRA_PLANNER = "claude"
$env:ORCHESTRA_WORKSPACE_PATH = "C:\path\to\your\repo"
npm run dev -- --parallel "Make the requested batch of changes"
```

The planner also produces a compact brief that is passed into worker prompts so each worker has useful context without rediscovering everything from scratch.

## Typecheck

```bash
npm run typecheck
```

## Where Files Are Saved

Generated projects are saved outside the Orchestra source repo.

Default:

```txt
C:\Users\<you>\Desktop\Orchestra Projects\
```

Override:

```powershell
$env:ORCHESTRA_GENERATED_ROOT = "C:\Users\shcar\Desktop\My Orchestra Projects"
```

For a todo prompt, the current builder creates:

```txt
C:\Users\<you>\Desktop\Orchestra Projects\simple-todo-app\
  index.html
  styles.css
  app.js
```

In existing repo mode, files are changed inside the repo selected by `ORCHESTRA_WORKSPACE_PATH`.

## Where Logs Are Saved

Run logs are also saved outside the Orchestra source repo.

Default:

```txt
C:\Users\<you>\Documents\Orchestra\runs\
```

Override:

```powershell
$env:ORCHESTRA_RUNS_ROOT = "C:\Users\shcar\Documents\Orchestra Runs"
```

`ORCHESTRA_RUNS_ROOT` must be outside the Orchestra source repo.

The filename includes the run id:

```txt
C:\Users\<you>\Documents\Orchestra\runs\run_....json
```

## How To Debug A Run

After running the project, use the terminal summary to find the project path and log path.

Check the generated files at the project path printed in the terminal:

```bash
ls "C:\Users\<you>\Desktop\Orchestra Projects\simple-todo-app"
```

Open the JSON log named in the terminal output. The important events are:

```txt
orchestrator.started
planner.started
planner.completed
builder.started
builder.completed
reviewer.started
reviewer.completed
orchestrator.completed
```

If a run fails after the orchestrator starts, Orchestra still saves a log. The terminal prints:

```txt
Run failed
Error: ...
Log path: C:\Users\<you>\Documents\Orchestra\runs\run_....json
```

Open that log and look for:

```txt
orchestrator.failed
```

That entry contains a structured error with `name`, `message`, and `stack`.

Use those events to answer:

- What prompt started the run?
- What tasks did the planner create?
- What files did the builder change?
- Did the reviewer pass?
- Did any review command pass or fail?
- If review failed, what issues were reported?
- If the run failed, what does `orchestrator.failed.output.error.message` say?

## Debugging Checklist

1. Did the terminal print a run id?
2. Did the printed project path contain the project folder?
3. Did the printed log path contain the JSON log?
4. Did `planner.completed` contain reasonable tasks?
5. Did `builder.completed` list the expected changed files?
6. Did `reviewer.completed` show `passed: true` or explain why it failed?
7. For existing repos, did `reviewer.completed.commandsRun` show the expected repo command?
8. For failed runs, did `orchestrator.failed` record the error?
