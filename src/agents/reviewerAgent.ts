import { runReviewCommand } from "../core/commandRunner";
import { getWorkspaceRoot } from "../core/fileSystem";
import type { ProjectFile, ReviewResult, ReviewerInput } from "../core/types";

export class ReviewerAgent {
  async review(input: ReviewerInput): Promise<ReviewResult> {
    if (input.projectState.workspace.kind === "existing-repo") {
      return reviewExistingRepo(input);
    }

    const expectedFiles = getExpectedFiles(input);
    const actualFiles = new Map(
      input.files.map((file) => [normalizePath(file.path), file]),
    );
    const issues: string[] = [];

    for (const expectedFile of expectedFiles) {
      const actualFile = actualFiles.get(expectedFile);

      if (!actualFile) {
        issues.push(`Missing expected file: ${expectedFile}`);
        continue;
      }

      if (isEmpty(actualFile)) {
        issues.push(`Expected file is empty: ${expectedFile}`);
      }
    }

    return {
      passed: issues.length === 0,
      issues,
      suggestions: createSuggestions(issues),
    };
  }
}

async function reviewExistingRepo(input: ReviewerInput): Promise<ReviewResult> {
  const issues: string[] = [];
  const commandsRun = input.reviewCommand
    ? [
        await runReviewCommand({
          command: input.reviewCommand,
          cwd: getWorkspaceRoot(input.projectState.workspace),
        }),
      ]
    : [];

  if (input.files.length === 0) {
    issues.push("No changed text files were detected in the existing repo.");
  }

  for (const file of input.files) {
    if (isEmpty(file)) {
      issues.push(`Changed file is empty: ${normalizePath(file.path)}`);
    }
  }

  for (const commandResult of commandsRun) {
    if (commandResult.exitCode !== 0) {
      issues.push(
        `Review command failed (${commandResult.exitCode}): ${commandResult.command}`,
      );
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    suggestions:
      issues.length > 0
        ? ["Inspect git status and the worker output before continuing."]
        : input.reviewCommand
          ? ["Review the git diff before merging."]
          : ["Review the git diff and run the repo's checks before merging."],
    commandsRun,
  };
}

function getExpectedFiles(input: ReviewerInput): string[] {
  return [
    ...new Set(
      input.projectState.tasks.flatMap((task) =>
        task.targetFiles.map((filePath) => normalizePath(filePath)),
      ),
    ),
  ];
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function isEmpty(file: ProjectFile): boolean {
  return file.content.trim().length === 0;
}

function createSuggestions(issues: string[]): string[] {
  if (issues.length > 0) {
    return ["Run the builder again or check the planner target files."];
  }

  return ["Add localStorage later so todos persist after refresh."];
}
