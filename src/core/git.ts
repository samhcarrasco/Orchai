import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CommandResult, ProjectFile } from "./types";

const execFileAsync = promisify(execFile);

export async function getGitStatusShort(repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--short", "--untracked-files=all"],
    {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    },
  );

  return String(stdout).trim();
}

export async function runGitCommand(input: {
  repoRoot: string;
  args: string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", input.args, {
      cwd: input.repoRoot,
      env: input.env ? { ...process.env, ...input.env } : process.env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: input.timeoutMs ?? 300_000,
    });

    return {
      command: formatGitCommand(input.args),
      exitCode: 0,
      stdout: String(stdout),
      stderr: String(stderr),
    };
  } catch (error) {
    const details = error as Error & {
      code?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };

    return {
      command: formatGitCommand(input.args),
      exitCode: typeof details.code === "number" ? details.code : 1,
      stdout: String(details.stdout ?? ""),
      stderr: String(details.stderr ?? details.message),
    };
  }
}

export async function getCurrentBranch(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024,
      },
    );

    return String(stdout).trim();
  } catch {
    return "HEAD";
  }
}

export async function getHeadSha(repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
  });

  return String(stdout).trim();
}

export async function getMergeBase(
  repoRoot: string,
  refA: string,
  refB: string,
): Promise<string> {
  const { stdout } = await execFileAsync("git", ["merge-base", refA, refB], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
  });

  return String(stdout).trim();
}

export async function isGitRepo(repoRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: repoRoot,
    });

    return String(stdout).trim() === "true";
  } catch {
    return false;
  }
}

export async function isGitWorktreeAvailable(repoRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    });

    return true;
  } catch {
    return false;
  }
}

export async function branchExists(
  repoRoot: string,
  branchName: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024,
      },
    );

    return true;
  } catch {
    return false;
  }
}

export interface GitWorktreeInfo {
  path: string;
  head?: string;
  branch?: string;
}

export async function listGitWorktrees(
  repoRoot: string,
): Promise<GitWorktreeInfo[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["worktree", "list", "--porcelain"],
    {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return parseWorktreeList(String(stdout));
}

export async function getGitOperationInProgress(
  repoRoot: string,
): Promise<string[]> {
  const operations = [
    { name: "merge", gitPath: "MERGE_HEAD" },
    { name: "cherry-pick", gitPath: "CHERRY_PICK_HEAD" },
    { name: "revert", gitPath: "REVERT_HEAD" },
    { name: "rebase", gitPath: "rebase-merge" },
    { name: "rebase", gitPath: "rebase-apply" },
  ];
  const active = new Set<string>();

  for (const operation of operations) {
    const operationPath = await getGitPath(repoRoot, operation.gitPath);

    try {
      await stat(operationPath);
      active.add(operation.name);
    } catch {
      continue;
    }
  }

  return [...active];
}

export function hasUnmergedStatusPaths(status: string): boolean {
  return status
    .split(/\r?\n/)
    .map((line) => line.slice(0, 2))
    .some((statusCode) =>
      ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(statusCode),
    );
}

export function parseGitStatusPaths(status: string): string[] {
  return [
    ...new Set(
      status
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const pathText = line.slice(3).trim();
          const renamedPath = pathText.split(" -> ").at(-1) ?? pathText;
          return stripQuotes(renamedPath).replaceAll("\\", "/");
        }),
    ),
  ];
}

export async function readChangedTextFiles(input: {
  repoRoot: string;
  paths: string[];
}): Promise<ProjectFile[]> {
  const files: ProjectFile[] = [];

  for (const filePath of input.paths) {
    const absolutePath = path.resolve(input.repoRoot, filePath);

    try {
      const fileStat = await stat(absolutePath);

      if (!fileStat.isFile()) {
        continue;
      }

      files.push({
        path: filePath,
        content: await readFile(absolutePath, "utf8"),
      });
    } catch {
      continue;
    }
  }

  return files;
}

async function getGitPath(repoRoot: string, gitPath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", gitPath], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
  });

  return path.resolve(repoRoot, String(stdout).trim());
}

function parseWorktreeList(output: string): GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = [];
  let current: GitWorktreeInfo | undefined;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) {
        worktrees.push(current);
        current = undefined;
      }
      continue;
    }

    if (line.startsWith("worktree ")) {
      if (current) {
        worktrees.push(current);
      }
      current = { path: line.slice("worktree ".length) };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }

  if (current) {
    worktrees.push(current);
  }

  return worktrees;
}

function formatGitCommand(args: string[]): string {
  return `git ${args.map(quoteArg).join(" ")}`;
}

function quoteArg(arg: string): string {
  return /\s/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  return value;
}
