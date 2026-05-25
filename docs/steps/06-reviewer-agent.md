# Step 06: Reviewer Agent

## Goal

Create a reviewer agent that checks whether the generated project looks valid.

The first reviewer will be rule-based, not AI-based.

## Teacher Explanation

The reviewer answers this question:

Did the builder produce something acceptable?

For now, acceptable means simple things:

- expected files exist
- files are not empty
- review feedback is saved

This is intentionally basic. A simple reviewer is better than no reviewer because it creates a feedback loop.

The reviewer should also stay part of the same Orchestra workflow for both generated projects and existing repos. For generated work, it can check expected files. For existing repo work later, it can check diffs, changed files, and project commands such as tests or typechecks.

## What We Will Create

When we work on this step, we will create:

```txt
src/agents/
  reviewerAgent.ts
```

## Reviewer Input

```ts
{
  projectState: ProjectState;
  files: ProjectFile[];
}
```

## Reviewer Output

```ts
{
  passed: boolean;
  issues: string[];
  suggestions: string[];
}
```

## Example Output

```json
{
  "passed": true,
  "issues": [],
  "suggestions": [
    "Add localStorage later so todos persist after refresh."
  ]
}
```

## Implementation Tasks

1. Create `ReviewerAgent`.
2. Read the expected files from the project state.
3. Check whether each expected file exists.
4. Check whether each file has content.
5. Return pass/fail feedback.
6. Log reviewer start and completion.

## Acceptance Criteria

This step is complete when:

- Review passes if expected files exist and are not empty.
- Review fails if a required file is missing.
- Review output includes `passed`, `issues`, and `suggestions`.
- Reviewer activity appears in the run log.

## Check Before Moving On

Ask yourself:

- Why should review be separate from building?
- What is one rule the reviewer can check without using AI?
- How would the log help if review fails?

## Common Mistakes

- Making the reviewer too advanced too early.
- Only printing feedback instead of returning structured feedback.
- Forgetting to save failed review details.
