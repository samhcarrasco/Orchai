import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { branchExists, getGitStatusShort, parseGitStatusPaths } from "./git";
import type { ParallelFeatureRequest } from "./parallelTypes";

const execFileAsync = promisify(execFile);

export interface GitWorktreeSpec {
  featureId: string;
  featureTitle: string;
  branchName: string;
  worktreePath: string;
  slug: string;
}

export function createGitWorktreeSpec(input: {
  feature: ParallelFeatureRequest;
  parallelRunId: string;
  repoName: string;
  worktreesRoot: string;
}): GitWorktreeSpec {
  const runShort = shortHash(input.parallelRunId, 8);
  const baseSlug = sanitizeSlug(
    `${input.feature.id}-${input.feature.title}`,
    input.feature.id || "feature",
  );
  const hash = shortHash(
    `${input.parallelRunId}:${input.feature.id}:${input.feature.title}`,
    8,
  );
  const slug = appendHash(baseSlug, hash, 64);
  const safeRepoName = sanitizeSlug(input.repoName, "repo");
  const root = path.resolve(input.worktreesRoot);
  const worktreePath = path.resolve(
    root,
    safeRepoName,
    input.parallelRunId,
    slug,
  );

  assertInsideDirectory(worktreePath, root);

  return {
    featureId: input.feature.id,
    featureTitle: input.feature.title,
    branchName: `orchestra/${runShort}/${slug}`,
    worktreePath,
    slug,
  };
}

export async function assertGitWorktreeSpecAvailable(input: {
  baseRepoRoot: string;
  spec: GitWorktreeSpec;
}): Promise<void> {
  await assertValidBranchName({
    repoRoot: input.baseRepoRoot,
    branchName: input.spec.branchName,
  });

  if (await branchExists(input.baseRepoRoot, input.spec.branchName)) {
    throw new Error(`Branch already exists: ${input.spec.branchName}`);
  }

  if (existsSync(input.spec.worktreePath)) {
    throw new Error(`Worktree path already exists: ${input.spec.worktreePath}`);
  }
}

export async function createGitWorktree(input: {
  baseRepoRoot: string;
  spec: GitWorktreeSpec;
  baseHeadSha: string;
}): Promise<void> {
  await mkdir(path.dirname(input.spec.worktreePath), { recursive: true });

  await execFileAsync(
    "git",
    [
      "worktree",
      "add",
      "-b",
      input.spec.branchName,
      input.spec.worktreePath,
      input.baseHeadSha,
    ],
    {
      cwd: input.baseRepoRoot,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

export async function collectChangedPaths(repoRoot: string): Promise<string[]> {
  return parseGitStatusPaths(await getGitStatusShort(repoRoot));
}

export function createWorktreeCleanupCommand(input: {
  baseRepoRoot: string;
  worktreePath: string;
}): string {
  return `git -C "${input.baseRepoRoot}" worktree remove "${input.worktreePath}"`;
}

export function sanitizeSlug(value: string, fallback: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");

  return slug || fallback;
}

function appendHash(slug: string, hash: string, maxLength: number): string {
  const suffix = `-${hash}`;
  const trimmedSlug = slug
    .slice(0, Math.max(1, maxLength - suffix.length))
    .replace(/-+$/g, "");

  return `${trimmedSlug}${suffix}`;
}

function shortHash(value: string, length: number): string {
  return createHash("sha1").update(value).digest("hex").slice(0, length);
}

async function assertValidBranchName(input: {
  repoRoot: string;
  branchName: string;
}): Promise<void> {
  try {
    await execFileAsync("git", ["check-ref-format", "--branch", input.branchName], {
      cwd: input.repoRoot,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error(`Generated branch name is not valid: ${input.branchName}`);
  }
}

function assertInsideDirectory(targetPath: string, rootPath: string): void {
  const relativePath = path.relative(rootPath, targetPath);
  const isInside =
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath);

  if (!isInside) {
    throw new Error(`Generated worktree path is outside ${rootPath}: ${targetPath}`);
  }
}
