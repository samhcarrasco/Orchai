import { BuilderAgent } from "./agents/builderAgent";
import { PlannerAgent } from "./agents/plannerAgent";
import { ReviewerAgent } from "./agents/reviewerAgent";
import { createGeneratedProjectWorkspace, getWorkspaceDisplayPath } from "./core/fileSystem";
import type { LlmClient } from "./core/llmClient";
import type { RunLogger } from "./core/logger";
import type {
  ProjectState,
  SerializedError,
  UserRequest,
  WorkspaceTarget,
} from "./core/types";
import type { WorkspaceWorker } from "./core/workspaceWorker";

export type PlannerMode = "deterministic" | "claude";

export interface OrchestratorOptions {
  plannerMode?: PlannerMode;
  llmClient?: LlmClient;
  workspace?: WorkspaceTarget;
  existingRepoWorker?: WorkspaceWorker;
  generatedRoot?: string;
  reviewCommand?: string;
}

export class OrchestratorRunError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly logPath?: string,
  ) {
    const serializedError = serializeError(originalError);
    super(serializedError.message);
    this.name = "OrchestratorRunError";
  }
}

export async function runOrchestrator(
  request: UserRequest,
  logger: RunLogger,
  options: OrchestratorOptions = {},
): Promise<void> {
  const plannerMode = options.plannerMode ?? "deterministic";

  logger.log({
    agent: "orchestrator",
    event: "orchestrator.started",
    input: {
      request,
      plannerMode,
      workspace: options.workspace,
    },
  });

  try {
    const planner = new PlannerAgent(options.llmClient);

    logger.log({
      agent: "planner",
      event: "planner.started",
      input: {
        request,
        mode: plannerMode,
        workspaceKind: options.workspace?.kind ?? "generated-project",
        workspaceRoot: options.workspace?.rootPath,
      },
    });

    const plan = await planner.plan({
      request,
      workspaceKind: options.workspace?.kind ?? "generated-project",
      workspaceRoot: options.workspace?.rootPath,
    });

    logger.log({
      agent: "planner",
      event: "planner.completed",
      output: plan,
    });

    const workspace =
      options.workspace ??
      createGeneratedProjectWorkspace(plan.projectName, options.generatedRoot);

    const projectState: ProjectState = {
      userRequest: request,
      projectName: plan.projectName,
      workspace,
      tasks: plan.tasks,
      files: [],
      logs: [],
    };

    const builder = new BuilderAgent({
      existingRepoWorker: options.existingRepoWorker,
    });

    logger.log({
      agent: "builder",
      event: "builder.started",
      input: {
        projectName: projectState.projectName,
        workspace: projectState.workspace,
        tasks: projectState.tasks,
      },
    });

    const buildResult = await builder.build({
      projectState,
      tasks: plan.tasks,
    });
    projectState.files = buildResult.filesChanged;

    logger.log({
      agent: "builder",
      event: "builder.completed",
      output: buildResult,
    });

    const reviewer = new ReviewerAgent();

    logger.log({
      agent: "reviewer",
      event: "reviewer.started",
      input: {
        projectName: projectState.projectName,
        files: buildResult.filesChanged.map((file) => file.path),
        reviewCommand: options.reviewCommand,
      },
    });

    const reviewResult = await reviewer.review({
      projectState,
      files: buildResult.filesChanged,
      reviewCommand: options.reviewCommand,
    });

    logger.log({
      agent: "reviewer",
      event: "reviewer.completed",
      output: reviewResult,
    });

    const projectPath = getWorkspaceDisplayPath(workspace);

    logger.log({
      agent: "orchestrator",
      event: "orchestrator.completed",
      output: {
        printedPrompt: request.prompt,
        projectPath,
        plan,
        buildResult,
        reviewResult,
      },
    });

    const logPath = await logger.save();

    console.log("Run complete");
    console.log(`Run ID: ${logger.runId}`);
    console.log(`Planner: ${plannerMode}`);
    console.log(`Workspace: ${workspace.kind}`);
    console.log(`Prompt: ${request.prompt}`);
    console.log(`Project path: ${projectPath}`);
    console.log(`Tasks: ${plan.tasks.length}`);
    console.log(`Files changed: ${buildResult.filesChanged.length}`);
    console.log(`Review passed: ${reviewResult.passed}`);
    if (reviewResult.commandsRun?.length) {
      console.log(`Review commands: ${reviewResult.commandsRun.length}`);
    }
    console.log(`Log path: ${logPath}`);
  } catch (error) {
    logger.log({
      agent: "orchestrator",
      event: "orchestrator.failed",
      output: {
        error: serializeError(error),
      },
    });

    const logPath = await logger.save();
    throw new OrchestratorRunError(error, logPath);
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}
