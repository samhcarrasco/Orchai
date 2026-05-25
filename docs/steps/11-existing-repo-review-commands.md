# Step 11: Existing Repo Review Commands

## Goal

Run repo-specific validation commands after Orchestra changes an existing repo.

## Teacher Explanation

Different repos have different correct review commands.

One repo might use:

```txt
npm run mr-check
```

Another might use:

```txt
npm test
```

Another might use:

```txt
pnpm lint
```

So Orchestra should not hardcode one universal command.

The first version lets the user provide the command:

```powershell
$env:ORCHESTRA_REVIEW_COMMAND = "npm run mr-check"
```

Then the reviewer runs that command inside the selected existing repo and records:

- command
- exit code
- stdout
- stderr

## Flow

```txt
prompt
  -> planner
  -> Claude worker edits existing repo
  -> reviewer checks changed files
  -> reviewer runs ORCHESTRA_REVIEW_COMMAND
  -> logger records the result
```

## Why This Matters

For existing repo work, "files changed" is not enough.

The reviewer should also answer:

```txt
Did the repo's own checks pass after the change?
```

## Acceptance Criteria

This step is complete when:

- `ORCHESTRA_REVIEW_COMMAND` is optional.
- The command runs inside `ORCHESTRA_WORKSPACE_PATH`.
- A zero exit code keeps review passing.
- A nonzero exit code makes review fail.
- stdout, stderr, exit code, and command are saved in the run log.
