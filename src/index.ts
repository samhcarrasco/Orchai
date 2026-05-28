import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OrchestratorRunError,
  runOrchestrator,
  serializeError,
} from "./orchestrator";
import { runParallelOrchestrator } from "./orchestratorParallel";
import {
  createExistingRepoWorkspace,
  getDefaultGeneratedRoot,
} from "./core/fileSystem";
import { isGitRepo } from "./core/git";
import { ClaudeCliLlmClient } from "./core/llmClient";
import { createRunId, DEFAULT_RUNS_DIR, RunLogger } from "./core/logger";
import type { UserRequest, WorkspaceTarget } from "./core/types";
import { ClaudeCliWorkspaceWorker } from "./core/workspaceWorker";
import type { PlannerMode } from "./orchestrator";

try {
  await main();
} catch (error) {
  process.exitCode = 1;

  if (error instanceof OrchestratorRunError) {
    const serializedError = serializeError(error.originalError);
    console.error("Run failed");
    console.error(`Error: ${serializedError.message}`);
    if (error.logPath) {
      console.error(`Log path: ${error.logPath}`);
    }
  } else {
    const serializedError = serializeError(error);
    console.error("Startup failed");
    console.error(`Error: ${serializedError.message}`);
  }
}

async function main(): Promise<void> {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const request: UserRequest = { prompt: cliArgs.prompt };
  const plannerMode = getPlannerMode();
  const runsRoot = getRunsRoot();
  const reviewCommand = getReviewCommand();

  if (cliArgs.parallel) {
    await runParallelMode({
      request,
      plannerMode,
      runsRoot,
      reviewCommand,
    });
    return;
  }

  const generatedRoot = getGeneratedRoot();
  const logger = new RunLogger(undefined, runsRoot);
  const workspace = await getWorkspace();
  const llmClient =
    plannerMode === "claude"
      ? new ClaudeCliLlmClient({
          command: process.env.ORCHESTRA_CLAUDE_COMMAND,
          model: getOptionalEnv("ORCHESTRA_PLANNER_MODEL"),
        })
      : undefined;
  const existingRepoWorker =
    workspace?.kind === "existing-repo"
      ? new ClaudeCliWorkspaceWorker({
          command: process.env.ORCHESTRA_CLAUDE_COMMAND,
          model: getOptionalEnv("ORCHESTRA_WORKER_MODEL"),
          allowDirtyRepo: process.env.ORCHESTRA_ALLOW_DIRTY_REPO === "1",
        })
      : undefined;

  await runOrchestrator(request, logger, {
    plannerMode,
    llmClient,
    workspace,
    generatedRoot,
    existingRepoWorker,
    reviewCommand,
  });
}

interface CliArgs {
  parallel: boolean;
  prompt: string;
}

function parseCliArgs(args: string[]): CliArgs {
  const parallelFlagIndex = args.indexOf("--parallel");

  if (parallelFlagIndex >= 0) {
    return {
      parallel: true,
      prompt: args.slice(parallelFlagIndex + 1).join(" ").trim(),
    };
  }

  if (isNpmParallelFlagSet()) {
    return {
      parallel: true,
      prompt: args.join(" ").trim(),
    };
  }

  return {
    parallel: false,
    prompt: args.join(" "),
  };
}

function isNpmParallelFlagSet(): boolean {
  const value = process.env.npm_config_parallel;
  return value === "true" || value === "1";
}

async function runParallelMode(input: {
  request: UserRequest;
  plannerMode: PlannerMode;
  runsRoot: string;
  reviewCommand?: string;
}): Promise<void> {
  if (!input.request.prompt) {
    throw new Error("Parallel mode requires a plain-English batch prompt after --parallel.");
  }

  if (input.plannerMode !== "claude") {
    throw new Error(
      "Parallel mode requires ORCHESTRA_PLANNER=claude in v1. The deterministic planner cannot split natural-language batch requests.",
    );
  }

  if (!process.env.ORCHESTRA_WORKSPACE_PATH) {
    throw new Error("Parallel mode requires ORCHESTRA_WORKSPACE_PATH.");
  }

  const workspace = await getWorkspace();

  if (!workspace || workspace.kind !== "existing-repo") {
    throw new Error("Parallel mode requires ORCHESTRA_WORKSPACE_PATH to point to an existing git repo.");
  }

  const worktreesRoot = getWorktreesRoot();
  const logger = new RunLogger(createRunId("parallel_run"), input.runsRoot);
  const llmClient = new ClaudeCliLlmClient({
    command: process.env.ORCHESTRA_CLAUDE_COMMAND,
    model: getOptionalEnv("ORCHESTRA_PLANNER_MODEL"),
  });
  const workerModel = getOptionalEnv("ORCHESTRA_WORKER_MODEL");
  const existingRepoWorker = new ClaudeCliWorkspaceWorker({
    command: process.env.ORCHESTRA_CLAUDE_COMMAND,
    model: workerModel,
    allowDirtyRepo: true,
    timeoutMs: getParallelWorkerTimeoutMs(),
    openTerminal: true,
  });
  const conflictResolverWorker = new ClaudeCliWorkspaceWorker({
    command: process.env.ORCHESTRA_CLAUDE_COMMAND,
    model: getOptionalEnv("ORCHESTRA_CONFLICT_RESOLVER_MODEL") ?? workerModel,
    allowDirtyRepo: true,
    timeoutMs: getParallelWorkerTimeoutMs(),
    openTerminal: true,
  });

  await runParallelOrchestrator(input.request, logger, {
    llmClient,
    existingRepoWorker,
    conflictResolverWorker,
    baseRepoRoot: workspace.rootPath,
    worktreesRoot,
    runsRoot: input.runsRoot,
    reviewCommand: input.reviewCommand,
  });
}

function getPlannerMode(): PlannerMode {
  const mode = process.env.ORCHESTRA_PLANNER ?? "deterministic";

  if (mode === "deterministic" || mode === "claude") {
    return mode;
  }

  throw new Error(
    `Unsupported ORCHESTRA_PLANNER value "${mode}". Use "deterministic" or "claude".`,
  );
}

function getGeneratedRoot(): string {
  return getExternalRuntimePath({
    envName: "ORCHESTRA_GENERATED_ROOT",
    defaultPath: getDefaultGeneratedRoot(),
    label: "Generated project root",
  });
}

function getRunsRoot(): string {
  return getExternalRuntimePath({
    envName: "ORCHESTRA_RUNS_ROOT",
    defaultPath: DEFAULT_RUNS_DIR,
    label: "Run log root",
  });
}

function getWorktreesRoot(): string {
  return getExternalRuntimePath({
    envName: "ORCHESTRA_PARALLEL_WORKTREES_ROOT",
    defaultPath: path.join(os.homedir(), "Documents", "Orchestra", "worktrees"),
    label: "Parallel worktree root",
  });
}

function getReviewCommand(): string | undefined {
  return getOptionalEnv("ORCHESTRA_REVIEW_COMMAND");
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function getParallelWorkerTimeoutMs(): number {
  const value = process.env.ORCHESTRA_PARALLEL_WORKER_TIMEOUT_MS?.trim();

  if (!value) {
    return 3_600_000;
  }

  const timeoutMs = Number(value);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Invalid ORCHESTRA_PARALLEL_WORKER_TIMEOUT_MS value "${value}". Use a positive millisecond value.`,
    );
  }

  return timeoutMs;
}

function getExternalRuntimePath(input: {
  envName: string;
  defaultPath: string;
  label: string;
}): string {
  const targetPath = path.resolve(
    process.env[input.envName] ?? input.defaultPath,
  );

  assertOutsideToolDirectory(targetPath, input.label);
  return targetPath;
}

function assertOutsideToolDirectory(targetPath: string, label: string): void {
  const toolRoot = path.resolve(process.cwd());
  const relativePath = path.relative(toolRoot, targetPath);
  const isInsideToolRoot =
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));

  if (isInsideToolRoot) {
    throw new Error(
      `${label} must be outside the Orchestra tool directory: ${targetPath}`,
    );
  }
}

async function getWorkspace(): Promise<WorkspaceTarget | undefined> {
  const workspacePath = process.env.ORCHESTRA_WORKSPACE_PATH;

  if (!workspacePath) {
    return undefined;
  }

  const rootPath = path.resolve(workspacePath);
  assertOutsideToolDirectory(rootPath, "Existing repo workspace");

  if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    throw new Error(`ORCHESTRA_WORKSPACE_PATH is not a directory: ${rootPath}`);
  }

  if (!(await isGitRepo(rootPath))) {
    throw new Error(`ORCHESTRA_WORKSPACE_PATH must point to a git repo: ${rootPath}`);
  }

  return createExistingRepoWorkspace(rootPath);
}
