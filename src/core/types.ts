export interface UserRequest {
  prompt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  targetFiles: string[];
  status: "pending" | "in_progress" | "done" | "failed";
}

export interface ProjectFile {
  path: string;
  content: string;
}

export type WorkspaceKind = "generated-project" | "existing-repo";

export type WorkspaceTarget =
  | {
      kind: "generated-project";
      rootPath: string;
      projectName: string;
    }
  | {
      kind: "existing-repo";
      rootPath: string;
    };

export interface ProjectState {
  userRequest: UserRequest;
  projectName: string;
  workspace: WorkspaceTarget;
  tasks: Task[];
  files: ProjectFile[];
  logs: AgentLogEntry[];
}

export type AgentName =
  | "orchestrator"
  | "parallel-orchestrator"
  | "planner"
  | "builder"
  | "reviewer";

export interface AgentLogEntry {
  timestamp: string;
  runId: string;
  agent: AgentName;
  event: string;
  parentRunId?: string;
  workerId?: string;
  input?: unknown;
  output?: unknown;
}

export interface RunLog {
  runId: string;
  entries: AgentLogEntry[];
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface PlannerInput {
  request: UserRequest;
  workspaceKind: WorkspaceKind;
  workspaceRoot?: string;
}

export interface PlannerOutput {
  projectName: string;
  tasks: Task[];
}

export interface BuilderInput {
  projectState: ProjectState;
  tasks: Task[];
  workerDisplayName?: string;
  workerTranscriptPath?: string;
}

export interface BuilderOutput {
  filesChanged: ProjectFile[];
  notes: string;
  commandsRun?: string[];
  gitStatusBefore?: string;
  gitStatusAfter?: string;
  transcriptPath?: string;
}

export interface ReviewerInput {
  projectState: ProjectState;
  files: ProjectFile[];
  reviewCommand?: string;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ReviewResult {
  passed: boolean;
  issues: string[];
  suggestions: string[];
  commandsRun?: CommandResult[];
}
