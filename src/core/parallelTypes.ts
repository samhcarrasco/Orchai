import type { BuilderOutput, ReviewResult, SerializedError } from "./types";

export type ParallelFeatureStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "review_failed"
  | "publish_failed";

export interface ParallelFeatureRequest {
  id: string;
  title: string;
  prompt: string;
  status: "pending";
  targetFiles?: string[];
}

export interface ParallelPlan {
  projectName: string;
  baseRepoRoot: string;
  baseBranch: string;
  baseHeadSha: string;
  features: ParallelFeatureRequest[];
}

export interface ParallelWorkerRun {
  workerId: string;
  feature: ParallelFeatureRequest;
  status: ParallelFeatureStatus;
  branchName: string;
  worktreePath: string;
  changedPaths: string[];
  filesChangedCount: number;
  reviewPassed?: boolean;
  commitResult?: ParallelCommitResult;
  rebaseResult?: ParallelRebaseResult;
  publishResult?: ParallelPublishResult;
  buildResult?: BuilderOutput;
  reviewResult?: ReviewResult;
  error?: SerializedError;
  logPath?: string;
  cleanupCommand: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ParallelCommitResult {
  status: "skipped" | "committed" | "failed";
  commitSha?: string;
  message?: string;
  error?: SerializedError;
  commandsRun: string[];
}

export interface ParallelRebaseResult {
  status:
    | "skipped"
    | "up_to_date"
    | "rebased"
    | "conflict_resolved"
    | "failed";
  baseRef: string;
  conflictDetected: boolean;
  resolverAttempts: number;
  resolverNotes?: string;
  error?: SerializedError;
  commandsRun: string[];
}

export interface ParallelPublishResult {
  status: "skipped" | "published" | "failed";
  remoteName: string;
  branchName: string;
  prUrl?: string;
  error?: SerializedError;
  commandsRun: string[];
}

export interface ConflictReport {
  hasConflicts: boolean;
  conflicts: Array<{
    path: string;
    workerIds: string[];
    featureIds: string[];
  }>;
}

export type ParallelRunStatus =
  | "completed"
  | "completed_with_failures"
  | "completed_with_conflicts"
  | "failed";

export interface ParallelRunResult {
  runId: string;
  status: ParallelRunStatus;
  plan: ParallelPlan;
  workers: ParallelWorkerRun[];
  conflictReport: ConflictReport;
  aggregateLogPath?: string;
}
