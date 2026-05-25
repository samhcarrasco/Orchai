import type { LlmClient } from "../core/llmClient";
import type {
  ParallelFeatureRequest,
  ParallelPlan,
} from "../core/parallelTypes";
import type { PlannerInput, PlannerOutput, Task } from "../core/types";

export interface ParallelPlannerInput {
  request: PlannerInput["request"];
  baseRepoRoot: string;
  baseBranch: string;
  baseHeadSha: string;
}

export class PlannerAgent {
  constructor(private readonly llmClient?: LlmClient) {}

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    if (this.llmClient) {
      return this.planWithLlm(input);
    }

    return this.planDeterministically(input);
  }

  async planParallel(input: ParallelPlannerInput): Promise<ParallelPlan> {
    if (!this.llmClient) {
      throw new Error(
        "Parallel planning requires ORCHESTRA_PLANNER=claude. The deterministic planner cannot split natural-language batch requests in v1.",
      );
    }

    const output = await this.llmClient.completeJson<ParallelPlannerOutput>({
      systemPrompt: createParallelPlannerSystemPrompt(),
      userPrompt: createParallelPlannerUserPrompt(input),
      jsonSchema: parallelPlannerOutputSchema,
      timeoutMs: 120_000,
    });

    return validateParallelPlannerOutput(output, input);
  }

  private planDeterministically(input: PlannerInput): PlannerOutput {
    if (input.workspaceKind === "existing-repo") {
      return createExistingRepoPlan(input);
    }

    const prompt = input.request.prompt.toLowerCase();

    if (prompt.includes("todo")) {
      return {
        projectName: "simple-todo-app",
        tasks: createTodoTasks(),
      };
    }

    return {
      projectName: "static-site",
      tasks: createStaticSiteTasks(),
    };
  }

  private async planWithLlm(input: PlannerInput): Promise<PlannerOutput> {
    const output = await this.llmClient!.completeJson<PlannerOutput>({
      systemPrompt: createPlannerSystemPrompt(),
      userPrompt: createPlannerUserPrompt(input),
      jsonSchema: plannerOutputSchema,
      timeoutMs: 120_000,
    });

    return validatePlannerOutput(output);
  }
}

function createTodoTasks(): Task[] {
  return [
    {
      id: "task_001",
      title: "Create HTML page",
      description:
        "Create an index.html file with a todo input, add button, and todo list.",
      targetFiles: ["index.html"],
      status: "pending",
    },
    {
      id: "task_002",
      title: "Create stylesheet",
      description:
        "Create a styles.css file that makes the todo app clear and usable.",
      targetFiles: ["styles.css"],
      status: "pending",
    },
    {
      id: "task_003",
      title: "Create app behavior",
      description:
        "Create an app.js file that lets users add, complete, and remove todo items.",
      targetFiles: ["app.js"],
      status: "pending",
    },
  ];
}

function createStaticSiteTasks(): Task[] {
  return [
    {
      id: "task_001",
      title: "Create HTML page",
      description:
        "Create an index.html file with a clear page structure for the requested site.",
      targetFiles: ["index.html"],
      status: "pending",
    },
    {
      id: "task_002",
      title: "Create stylesheet",
      description:
        "Create a styles.css file with layout, typography, and responsive styling.",
      targetFiles: ["styles.css"],
      status: "pending",
    },
  ];
}

function createExistingRepoPlan(input: PlannerInput): PlannerOutput {
  return {
    projectName: "existing-repo",
    tasks: [
      {
        id: "task_001",
        title: "Inspect repository context",
        description: `Inspect the selected repo and identify the files needed for: ${input.request.prompt}`,
        targetFiles: ["."],
        status: "pending",
      },
      {
        id: "task_002",
        title: "Implement requested repo change",
        description: `Make targeted edits in the selected repo for: ${input.request.prompt}`,
        targetFiles: ["."],
        status: "pending",
      },
    ],
  };
}

function createPlannerSystemPrompt(): string {
  return [
    "You are the planner agent for Orchestra.",
    "Turn the user's request into a structured implementation plan.",
    "Return exactly one JSON object matching the provided schema.",
    "Do not include markdown, commentary, bullet lists, or file contents.",
    "Your response must start with { and end with }.",
    "Tasks should describe what to create or edit.",
    "targetFiles must be relative file paths inside the selected workspace.",
    "Every task status must be pending.",
    "For a todo app, use projectName simple-todo-app and target files index.html, styles.css, and app.js.",
    "For an existing repo, plan targeted edits for that repository instead of generating a standalone toy app unless the user asks for one.",
  ].join(" ");
}

function createPlannerUserPrompt(input: PlannerInput): string {
  return [
    `Workspace kind: ${input.workspaceKind}`,
    input.workspaceRoot ? `Workspace root: ${input.workspaceRoot}` : undefined,
    `User request: ${input.request.prompt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

type ParallelPlannerOutput = Pick<ParallelPlan, "projectName" | "features">;

function createParallelPlannerSystemPrompt(): string {
  return [
    "You are the parallel planner agent for Orchestra.",
    "Split one plain-English batch request for an existing git repo into 2 to 5 independent feature requests.",
    "Each feature prompt must be standalone, scoped, and suitable for a separate worker in its own git worktree.",
    "Prefer features that touch different files or clearly separable areas of the codebase.",
    "Do not include merge, rebase, cherry-pick, cleanup, or branch-management instructions.",
    "Return exactly one JSON object matching the provided schema.",
    "Do not include markdown, commentary, bullet lists, or file contents.",
    "Every feature status must be pending.",
  ].join(" ");
}

function createParallelPlannerUserPrompt(input: ParallelPlannerInput): string {
  return [
    `Base repo root: ${input.baseRepoRoot}`,
    `Base branch: ${input.baseBranch}`,
    `Base HEAD: ${input.baseHeadSha}`,
    `Batch request: ${input.request.prompt}`,
  ].join("\n");
}

const plannerOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectName", "tasks"],
  properties: {
    projectName: {
      type: "string",
      minLength: 1,
    },
    tasks: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "targetFiles", "status"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
          },
          title: {
            type: "string",
            minLength: 1,
          },
          description: {
            type: "string",
            minLength: 1,
          },
          targetFiles: {
            type: "array",
            minItems: 1,
            items: {
              type: "string",
              minLength: 1,
            },
          },
          status: {
            type: "string",
            enum: ["pending"],
          },
        },
      },
    },
  },
} as const;

const parallelPlannerOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectName", "features"],
  properties: {
    projectName: {
      type: "string",
      minLength: 1,
    },
    features: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "prompt", "status"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
          },
          title: {
            type: "string",
            minLength: 1,
          },
          prompt: {
            type: "string",
            minLength: 1,
          },
          status: {
            type: "string",
            enum: ["pending"],
          },
          targetFiles: {
            type: "array",
            minItems: 1,
            items: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
    },
  },
} as const;

function validatePlannerOutput(output: PlannerOutput): PlannerOutput {
  if (!isSafeProjectName(output.projectName)) {
    throw new Error(`Invalid planner project name: ${output.projectName}`);
  }

  if (!Array.isArray(output.tasks) || output.tasks.length < 2) {
    throw new Error("Planner output must include at least two tasks.");
  }

  for (const task of output.tasks) {
    if (!task.id || !task.title || !task.description) {
      throw new Error("Planner task is missing id, title, or description.");
    }

    if (task.status !== "pending") {
      throw new Error(`Planner task must start as pending: ${task.id}`);
    }

    if (!Array.isArray(task.targetFiles) || task.targetFiles.length === 0) {
      throw new Error(`Planner task has no target files: ${task.id}`);
    }

    for (const targetFile of task.targetFiles) {
      if (!isSafeRelativePath(targetFile)) {
        throw new Error(`Unsafe planner target file: ${targetFile}`);
      }
    }
  }

  return output;
}

function validateParallelPlannerOutput(
  output: ParallelPlannerOutput,
  input: ParallelPlannerInput,
): ParallelPlan {
  if (!isSafeProjectName(output.projectName)) {
    throw new Error(`Invalid parallel planner project name: ${output.projectName}`);
  }

  if (
    !Array.isArray(output.features) ||
    output.features.length < 2 ||
    output.features.length > 5
  ) {
    throw new Error("Parallel planner output must include 2 to 5 features.");
  }

  const ids = new Set<string>();
  const features: ParallelFeatureRequest[] = output.features.map((feature) => {
    if (!isSafeFeatureId(feature.id)) {
      throw new Error(`Invalid parallel feature id: ${feature.id}`);
    }

    if (ids.has(feature.id)) {
      throw new Error(`Duplicate parallel feature id: ${feature.id}`);
    }

    ids.add(feature.id);

    if (!feature.title || !feature.prompt) {
      throw new Error("Parallel feature is missing title or prompt.");
    }

    if (feature.status !== "pending") {
      throw new Error(`Parallel feature must start as pending: ${feature.id}`);
    }

    if (feature.targetFiles) {
      for (const targetFile of feature.targetFiles) {
        if (!isSafeRelativePath(targetFile)) {
          throw new Error(`Unsafe parallel target file: ${targetFile}`);
        }
      }
    }

    return feature;
  });

  return {
    projectName: output.projectName,
    baseRepoRoot: input.baseRepoRoot,
    baseBranch: input.baseBranch,
    baseHeadSha: input.baseHeadSha,
    features,
  };
}

function isSafeProjectName(projectName: string): boolean {
  return (
    projectName.trim().length > 0 &&
    !projectName.includes("/") &&
    !projectName.includes("\\") &&
    !projectName.includes("..")
  );
}

function isSafeRelativePath(filePath: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const parts = normalizedPath.split("/");

  return (
    normalizedPath.trim().length > 0 &&
    !normalizedPath.startsWith("/") &&
    !normalizedPath.includes(":") &&
    !parts.includes("..") &&
    !parts.includes("")
  );
}

function isSafeFeatureId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id);
}
