import path from "node:path";
import { BuilderAgent } from "./agents/builderAgent";
import { PlannerAgent } from "./agents/plannerAgent";
import { ReviewerAgent } from "./agents/reviewerAgent";
import { OrchestratorRunError, serializeError } from "./orchestrator";
import { runProcessCommand } from "./core/commandRunner";
import { createExistingRepoWorkspace } from "./core/fileSystem";
import {
  getCurrentBranch,
  getGitOperationInProgress,
  getGitStatusShort,
  getHeadSha,
  hasUnmergedStatusPaths,
  isGitRepo,
  isGitWorktreeAvailable,
  listGitWorktrees,
  runGitCommand,
} from "./core/git";
import {
  collectChangedPaths,
  createGitWorktree,
  createGitWorktreeSpec,
  createWorktreeCleanupCommand,
  type GitWorktreeSpec,
  assertGitWorktreeSpecAvailable,
} from "./core/gitWorktree";
import type { LlmClient } from "./core/llmClient";
import { RunLogger } from "./core/logger";
import type {
  ConflictReport,
  ParallelPlan,
  ParallelRunResult,
  ParallelRunStatus,
  ParallelWorkerRun,
} from "./core/parallelTypes";
import type {
  BuilderOutput,
  CommandResult,
  ProjectState,
  ReviewResult,
  Task,
  UserRequest,
  WorkspaceTarget,
} from "./core/types";
import type { WorkspaceWorker } from "./core/workspaceWorker";

export interface ParallelOrchestratorOptions {
  llmClient: LlmClient;
  existingRepoWorker: WorkspaceWorker;
  conflictResolverWorker: WorkspaceWorker;
  baseRepoRoot: string;
  worktreesRoot: string;
  runsRoot: string;
  reviewCommand?: string;
}

export async function runParallelOrchestrator(
  request: UserRequest,
  logger: RunLogger,
  options: ParallelOrchestratorOptions,
): Promise<void> {
  const baseRepoRoot = path.resolve(options.baseRepoRoot);
  const worktreesRoot = path.resolve(options.worktreesRoot);
  let createdWorkers: ParallelWorkerRun[] = [];
  let plan: ParallelPlan | undefined;

  logger.log({
    agent: "parallel-orchestrator",
    event: "parallel.started",
    input: {
      request,
      baseRepoRoot,
      worktreesRoot,
      reviewCommand: options.reviewCommand,
    },
  });

  try {
    await assertParallelStartupSafe({ baseRepoRoot, worktreesRoot });

    const [baseBranch, baseHeadSha] = await Promise.all([
      getCurrentBranch(baseRepoRoot),
      getHeadSha(baseRepoRoot),
    ]);

    const planner = new PlannerAgent(options.llmClient);

    logger.log({
      agent: "planner",
      event: "parallel.planner.started",
      input: {
        request,
        baseRepoRoot,
        baseBranch,
        baseHeadSha,
      },
    });

    plan = await planner.planParallel({
      request,
      baseRepoRoot,
      baseBranch,
      baseHeadSha,
    });

    logger.log({
      agent: "planner",
      event: "parallel.planner.completed",
      output: plan,
    });

    const specs = await createAndValidateWorktreeSpecs({
      plan,
      parallelRunId: logger.runId,
      worktreesRoot,
    });
    const plannedWorkers = createInitialWorkerRuns({
      plan,
      specs,
      parallelRunId: logger.runId,
    });

    for (const worker of plannedWorkers) {
      logger.log({
        agent: "parallel-orchestrator",
        event: "parallel.worktree.creating",
        input: {
          workerId: worker.workerId,
          featureId: worker.feature.id,
          branchName: worker.branchName,
          worktreePath: worker.worktreePath,
        },
      });

      await createGitWorktree({
        baseRepoRoot,
        spec: specs.get(worker.feature.id)!,
        baseHeadSha,
      });

      createdWorkers.push(worker);

      logger.log({
        agent: "parallel-orchestrator",
        event: "parallel.worktree.created",
        output: {
          workerId: worker.workerId,
          featureId: worker.feature.id,
          branchName: worker.branchName,
          worktreePath: worker.worktreePath,
        },
      });
    }

    logger.log({
      agent: "parallel-orchestrator",
      event: "parallel.workers.started",
      input: {
        workers: createdWorkers.map((worker) => ({
          workerId: worker.workerId,
          featureId: worker.feature.id,
          title: worker.feature.title,
          branchName: worker.branchName,
          worktreePath: worker.worktreePath,
        })),
      },
    });

    const settledWorkers = await Promise.allSettled(
      createdWorkers.map((worker) =>
        runParallelWorker({
          worker,
          plan: plan!,
          parallelRunId: logger.runId,
          runsRoot: options.runsRoot,
          existingRepoWorker: options.existingRepoWorker,
          conflictResolverWorker: options.conflictResolverWorker,
          reviewCommand: options.reviewCommand,
        }),
      ),
    );
    const workers = await normalizeSettledWorkers(createdWorkers, settledWorkers);
    const conflictReport = createConflictReport(workers);
    const status = getParallelRunStatus(workers, conflictReport);
    const result: ParallelRunResult = {
      runId: logger.runId,
      status,
      plan,
      workers,
      conflictReport,
    };

    logger.log({
      agent: "parallel-orchestrator",
      event: "parallel.completed",
      output: result,
    });

    const logPath = await logger.save();
    result.aggregateLogPath = logPath;

    printParallelReport({
      request,
      result,
      logPath,
    });
  } catch (error) {
    logger.log({
      agent: "parallel-orchestrator",
      event: "parallel.failed",
      output: {
        error: serializeError(error),
        plan,
        createdWorktrees: createdWorkers.map((worker) => ({
          workerId: worker.workerId,
          featureId: worker.feature.id,
          branchName: worker.branchName,
          worktreePath: worker.worktreePath,
          cleanupCommand: worker.cleanupCommand,
        })),
      },
    });
    logger.log({
      agent: "parallel-orchestrator",
      event: "orchestrator.failed",
      output: {
        error: serializeError(error),
      },
    });

    const logPath = await logger.save();
    throw new OrchestratorRunError(
      new Error(createParallelFailureMessage(error, createdWorkers)),
      logPath,
    );
  }
}

async function assertParallelStartupSafe(input: {
  baseRepoRoot: string;
  worktreesRoot: string;
}): Promise<void> {
  assertNoPathOverlap(
    process.cwd(),
    input.baseRepoRoot,
    "Parallel base repo must be outside the Orchestra source directory",
  );
  assertNoPathOverlap(
    process.cwd(),
    input.worktreesRoot,
    "Parallel worktree root must be outside the Orchestra source directory",
  );
  assertNoPathOverlap(
    input.baseRepoRoot,
    input.worktreesRoot,
    "Parallel worktree root must be outside the target repo",
  );

  if (!(await isGitRepo(input.baseRepoRoot))) {
    throw new Error(`Parallel base repo must be a git repo: ${input.baseRepoRoot}`);
  }

  const status = await getGitStatusShort(input.baseRepoRoot);

  if (status) {
    throw new Error(
      [
        "Parallel mode requires a clean base repo in v1.",
        "Commit or stash changes first. ORCHESTRA_ALLOW_DIRTY_REPO is ignored for parallel mode.",
        status,
      ].join("\n"),
    );
  }

  const operations = await getGitOperationInProgress(input.baseRepoRoot);

  if (operations.length > 0) {
    throw new Error(
      `Parallel mode cannot run while git has an operation in progress: ${operations.join(", ")}`,
    );
  }

  if (!(await isGitWorktreeAvailable(input.baseRepoRoot))) {
    throw new Error("git worktree is not available for the selected repository.");
  }
}

async function createAndValidateWorktreeSpecs(input: {
  plan: ParallelPlan;
  parallelRunId: string;
  worktreesRoot: string;
}): Promise<Map<string, GitWorktreeSpec>> {
  const repoName = path.basename(input.plan.baseRepoRoot);
  const specs = new Map<string, GitWorktreeSpec>();
  const branchNames = new Set<string>();
  const worktreePaths = new Set<string>();
  const existingWorktrees = await listGitWorktrees(input.plan.baseRepoRoot);

  for (const feature of input.plan.features) {
    const spec = createGitWorktreeSpec({
      feature,
      parallelRunId: input.parallelRunId,
      repoName,
      worktreesRoot: input.worktreesRoot,
    });
    const normalizedPath = path.resolve(spec.worktreePath).toLowerCase();

    if (branchNames.has(spec.branchName)) {
      throw new Error(`Generated duplicate branch name: ${spec.branchName}`);
    }

    if (worktreePaths.has(normalizedPath)) {
      throw new Error(`Generated duplicate worktree path: ${spec.worktreePath}`);
    }

    if (
      existingWorktrees.some(
        (worktree) => path.resolve(worktree.path).toLowerCase() === normalizedPath,
      )
    ) {
      throw new Error(`Worktree path is already registered: ${spec.worktreePath}`);
    }

    branchNames.add(spec.branchName);
    worktreePaths.add(normalizedPath);
    await assertGitWorktreeSpecAvailable({
      baseRepoRoot: input.plan.baseRepoRoot,
      spec,
    });
    specs.set(feature.id, spec);
  }

  return specs;
}

function createInitialWorkerRuns(input: {
  plan: ParallelPlan;
  specs: Map<string, GitWorktreeSpec>;
  parallelRunId: string;
}): ParallelWorkerRun[] {
  return input.plan.features.map((feature, index) => {
    const spec = input.specs.get(feature.id);

    if (!spec) {
      throw new Error(`Missing worktree spec for feature: ${feature.id}`);
    }

    const workerId = `${input.parallelRunId}_${String(index + 1).padStart(2, "0")}_${feature.id}`;

    return {
      workerId,
      feature,
      status: "pending",
      branchName: spec.branchName,
      worktreePath: spec.worktreePath,
      changedPaths: [],
      filesChangedCount: 0,
      cleanupCommand: createWorktreeCleanupCommand({
        baseRepoRoot: input.plan.baseRepoRoot,
        worktreePath: spec.worktreePath,
      }),
    };
  });
}

async function runParallelWorker(input: {
  worker: ParallelWorkerRun;
  plan: ParallelPlan;
  parallelRunId: string;
  runsRoot: string;
  existingRepoWorker: WorkspaceWorker;
  conflictResolverWorker: WorkspaceWorker;
  reviewCommand?: string;
}): Promise<ParallelWorkerRun> {
  const childLogger = new RunLogger(
    input.worker.workerId,
    path.join(input.runsRoot, input.parallelRunId),
  );
  const transcriptDir = path.join(input.runsRoot, input.parallelRunId);
  const runningWorker: ParallelWorkerRun = {
    ...input.worker,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  try {
    childLogger.log({
      agent: "parallel-orchestrator",
      event: "parallel.worker.started",
      parentRunId: input.parallelRunId,
      workerId: input.worker.workerId,
      input: {
        feature: input.worker.feature,
        branchName: input.worker.branchName,
        worktreePath: input.worker.worktreePath,
      },
    });

    const workspace = createExistingRepoWorkspace(input.worker.worktreePath);
    const tasks = createFeatureTasks(input.worker.feature);
    const projectState: ProjectState = {
      userRequest: {
        prompt: input.worker.feature.prompt,
      },
      projectName: input.plan.projectName,
      workspace,
      tasks,
      files: [],
      logs: [],
    };
    const builder = new BuilderAgent({
      existingRepoWorker: input.existingRepoWorker,
    });

    const maxBuildAttempts = getMaxBuildAttempts();
    let buildResult!: BuilderOutput;
    let reviewResult!: ReviewResult;

    for (let attempt = 1; attempt <= maxBuildAttempts; attempt += 1) {
      if (attempt > 1) {
        projectState.userRequest = {
          prompt: createRetryPrompt(input.worker.feature.prompt, reviewResult),
        };
      }

      childLogger.log({
        agent: "builder",
        event: "builder.started",
        parentRunId: input.parallelRunId,
        workerId: input.worker.workerId,
        input: {
          projectName: projectState.projectName,
          workspace,
          tasks,
          attempt,
        },
      });

      buildResult = await builder.build({
        projectState,
        tasks,
        workerDisplayName: `Orchestra ${input.worker.feature.id}: ${input.worker.feature.title}`,
        workerTranscriptPath: path.join(
          transcriptDir,
          `${input.worker.workerId}.attempt-${attempt}.claude.log`,
        ),
      });
      projectState.files = buildResult.filesChanged;

      childLogger.log({
        agent: "builder",
        event: "builder.completed",
        parentRunId: input.parallelRunId,
        workerId: input.worker.workerId,
        output: buildResult,
      });

      const reviewer = new ReviewerAgent();

      childLogger.log({
        agent: "reviewer",
        event: "reviewer.started",
        parentRunId: input.parallelRunId,
        workerId: input.worker.workerId,
        input: {
          projectName: projectState.projectName,
          files: buildResult.filesChanged.map((file) => file.path),
          reviewCommand: input.reviewCommand,
          attempt,
        },
      });

      reviewResult = await reviewer.review({
        projectState,
        files: buildResult.filesChanged,
        reviewCommand: input.reviewCommand,
      });

      childLogger.log({
        agent: "reviewer",
        event: "reviewer.completed",
        parentRunId: input.parallelRunId,
        workerId: input.worker.workerId,
        output: reviewResult,
      });

      if (reviewResult.passed) {
        break;
      }

      if (attempt < maxBuildAttempts) {
        childLogger.log({
          agent: "builder",
          event: "builder.retry",
          parentRunId: input.parallelRunId,
          workerId: input.worker.workerId,
          input: {
            attempt,
            nextAttempt: attempt + 1,
            issues: reviewResult.issues,
          },
        });
      }
    }

    const changedPaths = await safeCollectChangedPaths(input.worker.worktreePath);
    let completedWorker: ParallelWorkerRun = {
      ...runningWorker,
      status: reviewResult.passed ? "succeeded" : "review_failed",
      changedPaths,
      filesChangedCount: changedPaths.length,
      buildResult,
      reviewResult,
      reviewPassed: reviewResult.passed,
      endedAt: new Date().toISOString(),
    };

    if (reviewResult.passed) {
      completedWorker = await commitAndPublishWorker({
        worker: completedWorker,
        plan: input.plan,
        workspace,
        childLogger,
        parallelRunId: input.parallelRunId,
        transcriptDir,
        conflictResolverWorker: input.conflictResolverWorker,
        reviewCommand: input.reviewCommand,
      });
    }

    childLogger.log({
      agent: "parallel-orchestrator",
      event: "parallel.worker.completed",
      parentRunId: input.parallelRunId,
      workerId: input.worker.workerId,
      output: completedWorker,
    });

    completedWorker.logPath = await childLogger.save();
    return completedWorker;
  } catch (error) {
    const changedPaths = await safeCollectChangedPaths(input.worker.worktreePath);
    const failedWorker: ParallelWorkerRun = {
      ...runningWorker,
      status: "failed",
      changedPaths,
      filesChangedCount: changedPaths.length,
      error: serializeError(error),
      endedAt: new Date().toISOString(),
    };

    childLogger.log({
      agent: "parallel-orchestrator",
      event: "parallel.worker.failed",
      parentRunId: input.parallelRunId,
      workerId: input.worker.workerId,
      output: {
        error: failedWorker.error,
        changedPaths,
      },
    });
    childLogger.log({
      agent: "parallel-orchestrator",
      event: "orchestrator.failed",
      parentRunId: input.parallelRunId,
      workerId: input.worker.workerId,
      output: {
        error: failedWorker.error,
      },
    });

    failedWorker.logPath = await childLogger.save();
    return failedWorker;
  }
}

async function normalizeSettledWorkers(
  originalWorkers: ParallelWorkerRun[],
  settledWorkers: PromiseSettledResult<ParallelWorkerRun>[],
): Promise<ParallelWorkerRun[]> {
  const workers: ParallelWorkerRun[] = [];

  for (let index = 0; index < settledWorkers.length; index += 1) {
    const settledWorker = settledWorkers[index];

    if (settledWorker.status === "fulfilled") {
      workers.push(settledWorker.value);
      continue;
    }

    const originalWorker = originalWorkers[index];
    const changedPaths = await safeCollectChangedPaths(originalWorker.worktreePath);

    workers.push({
      ...originalWorker,
      status: "failed",
      changedPaths,
      filesChangedCount: changedPaths.length,
      error: serializeError(settledWorker.reason),
      endedAt: new Date().toISOString(),
    });
  }

  return workers;
}

async function commitAndPublishWorker(input: {
  worker: ParallelWorkerRun;
  plan: ParallelPlan;
  workspace: WorkspaceTarget;
  childLogger: RunLogger;
  parallelRunId: string;
  transcriptDir: string;
  conflictResolverWorker: WorkspaceWorker;
  reviewCommand?: string;
}): Promise<ParallelWorkerRun> {
  const commitResult = await commitWorkerChanges(input.worker);
  input.childLogger.log({
    agent: "parallel-orchestrator",
    event: "parallel.worker.commit.completed",
    parentRunId: input.parallelRunId,
    workerId: input.worker.workerId,
    output: commitResult,
  });

  if (commitResult.status !== "committed") {
    return {
      ...input.worker,
      status: commitResult.status === "failed" ? "publish_failed" : input.worker.status,
      commitResult,
      error: commitResult.error,
      endedAt: new Date().toISOString(),
    };
  }

  const rebaseResult = await rebaseWorkerBranch({
    worker: input.worker,
    plan: input.plan,
    workspace: input.workspace,
    transcriptDir: input.transcriptDir,
    conflictResolverWorker: input.conflictResolverWorker,
  });
  input.childLogger.log({
    agent: "parallel-orchestrator",
    event: "parallel.worker.rebase.completed",
    parentRunId: input.parallelRunId,
    workerId: input.worker.workerId,
    output: rebaseResult,
  });

  if (rebaseResult.status === "failed") {
    return {
      ...input.worker,
      status: "publish_failed",
      commitResult,
      rebaseResult,
      error: rebaseResult.error,
      endedAt: new Date().toISOString(),
    };
  }

  const postRebaseReviewResult = await reviewAfterBranchUpdate({
    worker: input.worker,
    plan: input.plan,
    workspace: input.workspace,
    reviewCommand: input.reviewCommand,
  });

  if (postRebaseReviewResult && !postRebaseReviewResult.passed) {
    input.childLogger.log({
      agent: "reviewer",
      event: "parallel.worker.post_rebase_review.failed",
      parentRunId: input.parallelRunId,
      workerId: input.worker.workerId,
      output: postRebaseReviewResult,
    });

    return {
      ...input.worker,
      status: "review_failed",
      commitResult,
      rebaseResult,
      reviewResult: postRebaseReviewResult,
      reviewPassed: false,
      endedAt: new Date().toISOString(),
    };
  }

  const publishResult = await publishWorkerBranch({
    worker: input.worker,
    plan: input.plan,
  });
  input.childLogger.log({
    agent: "parallel-orchestrator",
    event: "parallel.worker.publish.completed",
    parentRunId: input.parallelRunId,
    workerId: input.worker.workerId,
    output: publishResult,
  });

  return {
    ...input.worker,
    status: publishResult.status === "published" ? "succeeded" : "publish_failed",
    commitResult,
    rebaseResult,
    publishResult,
    error: publishResult.error,
    endedAt: new Date().toISOString(),
  };
}

async function commitWorkerChanges(
  worker: ParallelWorkerRun,
): Promise<NonNullable<ParallelWorkerRun["commitResult"]>> {
  const commandsRun: string[] = [];
  const status = await getGitStatusShort(worker.worktreePath);

  if (!status) {
    return {
      status: "skipped",
      message: "No uncommitted changes were present after review.",
      commandsRun,
    };
  }

  const addResult = await runGitCommand({
    repoRoot: worker.worktreePath,
    args: ["add", "-A"],
  });
  commandsRun.push(addResult.command);

  if (addResult.exitCode !== 0) {
    return {
      status: "failed",
      error: serializeCommandFailure(addResult),
      commandsRun,
    };
  }

  const message = createCommitMessage(worker);
  const commitResult = await runGitCommand({
    repoRoot: worker.worktreePath,
    args: ["commit", "-m", message],
  });
  commandsRun.push(commitResult.command);

  if (commitResult.exitCode !== 0) {
    return {
      status: "failed",
      message,
      error: serializeCommandFailure(commitResult),
      commandsRun,
    };
  }

  const headResult = await runGitCommand({
    repoRoot: worker.worktreePath,
    args: ["rev-parse", "HEAD"],
  });
  commandsRun.push(headResult.command);

  if (headResult.exitCode !== 0) {
    return {
      status: "failed",
      message,
      error: serializeCommandFailure(headResult),
      commandsRun,
    };
  }

  return {
    status: "committed",
    commitSha: headResult.stdout.trim(),
    message,
    commandsRun,
  };
}

async function rebaseWorkerBranch(input: {
  worker: ParallelWorkerRun;
  plan: ParallelPlan;
  workspace: WorkspaceTarget;
  transcriptDir: string;
  conflictResolverWorker: WorkspaceWorker;
}): Promise<NonNullable<ParallelWorkerRun["rebaseResult"]>> {
  const remoteName = getRemoteName();
  const baseRef = `${remoteName}/${input.plan.baseBranch}`;
  const commandsRun: string[] = [];
  const fetchResult = await runGitCommand({
    repoRoot: input.worker.worktreePath,
    args: ["fetch", remoteName, input.plan.baseBranch],
  });
  commandsRun.push(fetchResult.command);

  if (fetchResult.exitCode !== 0) {
    return {
      status: "failed",
      baseRef,
      conflictDetected: false,
      resolverAttempts: 0,
      error: serializeCommandFailure(fetchResult),
      commandsRun,
    };
  }

  const rebaseResult = await runGitCommand({
    repoRoot: input.worker.worktreePath,
    args: ["rebase", baseRef],
  });
  commandsRun.push(rebaseResult.command);

  if (rebaseResult.exitCode === 0) {
    return {
      status: isAlreadyUpToDate(rebaseResult) ? "up_to_date" : "rebased",
      baseRef,
      conflictDetected: false,
      resolverAttempts: 0,
      commandsRun,
    };
  }

  const conflictStatus = await getGitStatusShort(input.worker.worktreePath);

  if (!hasUnmergedStatusPaths(conflictStatus)) {
    return {
      status: "failed",
      baseRef,
      conflictDetected: false,
      resolverAttempts: 0,
      error: serializeCommandFailure(rebaseResult),
      commandsRun,
    };
  }

  const resolved = await resolveRebaseConflict({
    worker: input.worker,
    plan: input.plan,
    workspace: input.workspace,
    transcriptDir: input.transcriptDir,
    conflictResolverWorker: input.conflictResolverWorker,
    baseRef,
    commandsRun,
  });

  return resolved;
}

async function resolveRebaseConflict(input: {
  worker: ParallelWorkerRun;
  plan: ParallelPlan;
  workspace: WorkspaceTarget;
  transcriptDir: string;
  conflictResolverWorker: WorkspaceWorker;
  baseRef: string;
  commandsRun: string[];
}): Promise<NonNullable<ParallelWorkerRun["rebaseResult"]>> {
  const maxResolverAttempts = 2;
  let resolverNotes = "";

  for (let attempt = 1; attempt <= maxResolverAttempts; attempt += 1) {
    const status = await getGitStatusShort(input.worker.worktreePath);
    const conflictPaths = collectConflictPaths(status);
    const buildResult = await input.conflictResolverWorker.run({
      request: {
        prompt: createConflictResolverPrompt({
          worker: input.worker,
          plan: input.plan,
          baseRef: input.baseRef,
          status,
        }),
      },
      tasks: [
        {
          id: `${input.worker.feature.id}_rebase_conflict_resolution`,
          title: "Resolve rebase conflicts",
          description:
            "Resolve the current git rebase conflicts by integrating the feature work with the updated base branch.",
          targetFiles: conflictPaths.length > 0 ? conflictPaths : ["."],
          status: "pending",
        },
      ],
      workspace: input.workspace,
      displayName: `Orchestra rebase ${input.worker.feature.id}: attempt ${attempt}`,
      transcriptPath: path.join(
        input.transcriptDir,
        `${input.worker.workerId}.rebase-attempt-${attempt}.claude.log`,
      ),
    });
    resolverNotes = buildResult.notes;
    input.commandsRun.push(...(buildResult.commandsRun ?? []));

    const addResult = await runGitCommand({
      repoRoot: input.worker.worktreePath,
      args: ["add", "-A"],
    });
    input.commandsRun.push(addResult.command);

    if (addResult.exitCode !== 0) {
      return {
        status: "failed",
        baseRef: input.baseRef,
        conflictDetected: true,
        resolverAttempts: attempt,
        resolverNotes,
        error: serializeCommandFailure(addResult),
        commandsRun: input.commandsRun,
      };
    }

    const continueResult = await runGitCommand({
      repoRoot: input.worker.worktreePath,
      args: ["-c", "core.editor=true", "rebase", "--continue"],
      env: {
        GIT_EDITOR: "true",
        GIT_SEQUENCE_EDITOR: "true",
      },
    });
    input.commandsRun.push(continueResult.command);

    if (continueResult.exitCode === 0) {
      return {
        status: "conflict_resolved",
        baseRef: input.baseRef,
        conflictDetected: true,
        resolverAttempts: attempt,
        resolverNotes,
        commandsRun: input.commandsRun,
      };
    }

    const nextStatus = await getGitStatusShort(input.worker.worktreePath);

    if (!hasUnmergedStatusPaths(nextStatus)) {
      return {
        status: "failed",
        baseRef: input.baseRef,
        conflictDetected: true,
        resolverAttempts: attempt,
        resolverNotes,
        error: serializeCommandFailure(continueResult),
        commandsRun: input.commandsRun,
      };
    }
  }

  return {
    status: "failed",
    baseRef: input.baseRef,
    conflictDetected: true,
    resolverAttempts: maxResolverAttempts,
    resolverNotes,
    error: {
      name: "Error",
      message: "AI conflict resolver could not complete the rebase.",
    },
    commandsRun: input.commandsRun,
  };
}

async function reviewAfterBranchUpdate(input: {
  worker: ParallelWorkerRun;
  plan: ParallelPlan;
  workspace: WorkspaceTarget;
  reviewCommand?: string;
}): Promise<ReviewResult | undefined> {
  if (!input.reviewCommand) {
    return undefined;
  }

  const reviewer = new ReviewerAgent();
  const tasks = createFeatureTasks(input.worker.feature);
  const projectState: ProjectState = {
    userRequest: {
      prompt: input.worker.feature.prompt,
    },
    projectName: input.plan.projectName,
    workspace: input.workspace,
    tasks,
    files: input.worker.buildResult?.filesChanged ?? [],
    logs: [],
  };

  return reviewer.review({
    projectState,
    files: input.worker.buildResult?.filesChanged ?? [],
    reviewCommand: input.reviewCommand,
  });
}

async function publishWorkerBranch(input: {
  worker: ParallelWorkerRun;
  plan: ParallelPlan;
}): Promise<NonNullable<ParallelWorkerRun["publishResult"]>> {
  const remoteName = getRemoteName();
  const commandsRun: string[] = [];
  const pushResult = await runGitCommand({
    repoRoot: input.worker.worktreePath,
    args: ["push", "-u", remoteName, input.worker.branchName],
  });
  commandsRun.push(pushResult.command);

  if (pushResult.exitCode !== 0) {
    return {
      status: "failed",
      remoteName,
      branchName: input.worker.branchName,
      error: serializeCommandFailure(pushResult),
      commandsRun,
    };
  }

  const existingPrResult = await runProcessCommand({
    command: "gh",
    args: [
      "pr",
      "view",
      "--head",
      input.worker.branchName,
      "--json",
      "url",
      "--jq",
      ".url",
    ],
    cwd: input.worker.worktreePath,
  });
  commandsRun.push(existingPrResult.command);

  if (existingPrResult.exitCode === 0 && existingPrResult.stdout.trim()) {
    return {
      status: "published",
      remoteName,
      branchName: input.worker.branchName,
      prUrl: existingPrResult.stdout.trim(),
      commandsRun,
    };
  }

  const createPrResult = await runProcessCommand({
    command: "gh",
    args: [
      "pr",
      "create",
      "--base",
      input.plan.baseBranch,
      "--head",
      input.worker.branchName,
      "--title",
      input.worker.feature.title,
      "--body",
      createPullRequestBody(input.worker),
    ],
    cwd: input.worker.worktreePath,
  });
  commandsRun.push(createPrResult.command);

  if (createPrResult.exitCode !== 0) {
    return {
      status: "failed",
      remoteName,
      branchName: input.worker.branchName,
      error: serializeCommandFailure(createPrResult),
      commandsRun,
    };
  }

  return {
    status: "published",
    remoteName,
    branchName: input.worker.branchName,
    prUrl: extractPullRequestUrl(createPrResult.stdout),
    commandsRun,
  };
}

function createFeatureTasks(feature: ParallelWorkerRun["feature"]): Task[] {
  return [
    {
      id: `${feature.id}_task_001`,
      title: feature.title,
      description: feature.prompt,
      targetFiles: feature.targetFiles?.length ? feature.targetFiles : ["."],
      status: "pending",
    },
  ];
}

async function safeCollectChangedPaths(repoRoot: string): Promise<string[]> {
  try {
    return await collectChangedPaths(repoRoot);
  } catch {
    return [];
  }
}

function createConflictReport(workers: ParallelWorkerRun[]): ConflictReport {
  const pathToWorkers = new Map<string, ParallelWorkerRun[]>();

  for (const worker of workers) {
    for (const changedPath of worker.changedPaths) {
      const normalizedPath = changedPath.replaceAll("\\", "/");
      pathToWorkers.set(normalizedPath, [
        ...(pathToWorkers.get(normalizedPath) ?? []),
        worker,
      ]);
    }
  }

  const conflicts = [...pathToWorkers.entries()]
    .filter(([, pathWorkers]) => pathWorkers.length > 1)
    .map(([changedPath, pathWorkers]) => ({
      path: changedPath,
      workerIds: pathWorkers.map((worker) => worker.workerId),
      featureIds: pathWorkers.map((worker) => worker.feature.id),
    }));

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}

function getParallelRunStatus(
  workers: ParallelWorkerRun[],
  conflictReport: ConflictReport,
): ParallelRunStatus {
  if (conflictReport.hasConflicts) {
    return "completed_with_conflicts";
  }

  if (workers.some((worker) => worker.status !== "succeeded")) {
    return "completed_with_failures";
  }

  return "completed";
}

function printParallelReport(input: {
  request: UserRequest;
  result: ParallelRunResult;
  logPath: string;
}): void {
  console.log("Parallel run complete");
  console.log(`Parallel run ID: ${input.result.runId}`);
  console.log(`Status: ${input.result.status}`);
  console.log(`Base repo: ${input.result.plan.baseRepoRoot}`);
  console.log(
    `Base branch/HEAD: ${input.result.plan.baseBranch} @ ${input.result.plan.baseHeadSha}`,
  );
  console.log(`Prompt: ${input.request.prompt}`);
  console.log(`Aggregate log path: ${input.logPath}`);
  console.log("Feature results:");

  for (const worker of input.result.workers) {
    const reviewText =
      worker.reviewPassed === undefined
        ? "not run"
        : worker.reviewPassed
          ? "passed"
          : "failed";

    console.log(`- ${worker.feature.title}: ${worker.status}`);
    console.log(`  Branch: ${worker.branchName}`);
    console.log(`  Worktree: ${worker.worktreePath}`);
    console.log(`  Files changed: ${worker.filesChangedCount}`);
    console.log(`  Review: ${reviewText}`);
    if (worker.commitResult?.commitSha) {
      console.log(`  Commit: ${worker.commitResult.commitSha}`);
    } else if (worker.commitResult) {
      console.log(`  Commit: ${worker.commitResult.status}`);
    }
    if (worker.rebaseResult) {
      console.log(`  Rebase: ${worker.rebaseResult.status}`);
    }
    if (worker.publishResult?.prUrl) {
      console.log(`  PR: ${worker.publishResult.prUrl}`);
    } else if (worker.publishResult) {
      console.log(`  Publish: ${worker.publishResult.status}`);
    }
    if (worker.buildResult?.transcriptPath) {
      console.log(`  Claude transcript: ${worker.buildResult.transcriptPath}`);
    }
    console.log(`  Cleanup: ${worker.cleanupCommand}`);
    if (worker.logPath) {
      console.log(`  Worker log: ${worker.logPath}`);
    }
  }

  if (input.result.conflictReport.hasConflicts) {
    console.log("Conflicts detected:");
    for (const conflict of input.result.conflictReport.conflicts) {
      console.log(
        `- ${conflict.path}: ${conflict.featureIds.join(", ")} changed the same path`,
      );
    }
  } else {
    console.log("Conflicts detected: none");
  }

  console.log("Next steps:");
  console.log("- Inspect each PR/worktree and review the committed feature diff.");
  console.log("- Humans should merge approved PRs into the base branch.");
  console.log("- Remove worktrees manually when you are done with them.");
}

function createParallelFailureMessage(
  error: unknown,
  createdWorkers: ParallelWorkerRun[],
): string {
  const serializedError = serializeError(error);
  const createdWorktreeText =
    createdWorkers.length > 0
      ? [
          "Created worktrees were left in place:",
          ...createdWorkers.map(
            (worker) =>
              `${worker.feature.title}: ${worker.worktreePath} (${worker.branchName})\nCleanup: ${worker.cleanupCommand}`,
          ),
        ].join("\n")
      : "No worktrees were created.";

  return `${serializedError.message}\n${createdWorktreeText}`;
}

function createCommitMessage(worker: ParallelWorkerRun): string {
  return [
    `Orchestra: ${worker.feature.title}`,
    "",
    `Feature ID: ${worker.feature.id}`,
    `Worker ID: ${worker.workerId}`,
    "",
    worker.feature.prompt,
  ].join("\n");
}

function createConflictResolverPrompt(input: {
  worker: ParallelWorkerRun;
  plan: ParallelPlan;
  baseRef: string;
  status: string;
}): string {
  return [
    `Resolve the current git rebase conflicts for this feature branch.`,
    `Feature: ${input.worker.feature.title}`,
    `Feature prompt: ${input.worker.feature.prompt}`,
    `Base branch: ${input.plan.baseBranch}`,
    `Updated base ref: ${input.baseRef}`,
    "",
    "Integrate the feature changes with the updated base code.",
    "Keep the intent of the feature branch unless the updated base already implements it.",
    "Remove all conflict markers.",
    "Do not run git rebase, git merge, git commit, git push, or gh commands.",
    "Do not edit outside this worktree.",
    "",
    `Current git status:\n${input.status}`,
  ].join("\n");
}

function createPullRequestBody(worker: ParallelWorkerRun): string {
  return [
    "Generated by Orchestra parallel mode.",
    "",
    `Worker ID: ${worker.workerId}`,
    `Feature ID: ${worker.feature.id}`,
    "",
    "Prompt:",
    worker.feature.prompt,
    "",
    "Review:",
    worker.reviewPassed ? "Passed" : "Not passed",
  ].join("\n");
}

function collectConflictPaths(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) =>
      ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(line.slice(0, 2)),
    )
    .map((line) => {
      const pathText = line.slice(3).trim();
      const renamedPath = pathText.split(" -> ").at(-1) ?? pathText;
      return stripQuotes(renamedPath).replaceAll("\\", "/");
    });
}

function extractPullRequestUrl(stdout: string): string | undefined {
  return stdout
    .split(/\s+/)
    .find((part) => /^https?:\/\/\S+\/pull\/\d+/.test(part));
}

function getRemoteName(): string {
  return process.env.ORCHESTRA_GIT_REMOTE?.trim() || "origin";
}

function isAlreadyUpToDate(result: CommandResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();

  return output.includes("up to date") || output.includes("up-to-date");
}

function serializeCommandFailure(result: CommandResult): {
  name: string;
  message: string;
} {
  const details = [result.stderr.trim(), result.stdout.trim()]
    .filter(Boolean)
    .join("\n");

  return {
    name: "CommandFailed",
    message: details
      ? `${result.command} failed with exit code ${result.exitCode}\n${details}`
      : `${result.command} failed with exit code ${result.exitCode}`,
  };
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  return value;
}

function assertNoPathOverlap(pathA: string, pathB: string, message: string): void {
  const resolvedA = path.resolve(pathA);
  const resolvedB = path.resolve(pathB);

  if (isSameOrInside(resolvedA, resolvedB) || isSameOrInside(resolvedB, resolvedA)) {
    throw new Error(`${message}: ${resolvedB}`);
  }
}

function isSameOrInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function getMaxBuildAttempts(): number {
  const value = process.env.ORCHESTRA_MAX_BUILD_ATTEMPTS?.trim();

  if (!value) {
    return 3;
  }

  const attempts = Number(value);

  if (!Number.isFinite(attempts) || attempts < 1) {
    throw new Error(
      `Invalid ORCHESTRA_MAX_BUILD_ATTEMPTS value "${value}". Use a positive integer.`,
    );
  }

  return Math.floor(attempts);
}

function createRetryPrompt(originalPrompt: string, reviewResult: ReviewResult): string {
  return [
    originalPrompt,
    "",
    "A previous implementation attempt failed review with these issues:",
    ...reviewResult.issues.map((issue) => `- ${issue}`),
    "",
    "Fix all issues above while preserving the original feature intent.",
  ].join("\n");
}
