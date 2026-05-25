import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  getGitStatusShort,
  parseGitStatusPaths,
  readChangedTextFiles,
} from "./git";
import { getWorkspaceRoot } from "./fileSystem";
import type {
  BuilderOutput,
  Task,
  UserRequest,
  WorkspaceTarget,
} from "./types";

const execFileAsync = promisify(execFile);

export interface WorkspaceWorkerInput {
  request: UserRequest;
  tasks: Task[];
  workspace: WorkspaceTarget;
  displayName?: string;
  transcriptPath?: string;
}

export interface WorkspaceWorker {
  run(input: WorkspaceWorkerInput): Promise<BuilderOutput>;
}

export class ClaudeCliWorkspaceWorker implements WorkspaceWorker {
  constructor(
    private readonly options: {
      command?: string;
      allowDirtyRepo?: boolean;
      timeoutMs?: number;
      openTerminal?: boolean;
    } = {},
  ) {}

  async run(input: WorkspaceWorkerInput): Promise<BuilderOutput> {
    if (input.workspace.kind !== "existing-repo") {
      throw new Error("Claude workspace worker only supports existing repos.");
    }

    const repoRoot = getWorkspaceRoot(input.workspace);
    const gitStatusBefore = await getGitStatusShort(repoRoot);

    if (gitStatusBefore && !this.options.allowDirtyRepo) {
      throw new Error(
        [
          "Existing repo has uncommitted changes.",
          "Commit or stash them first, or set ORCHESTRA_ALLOW_DIRTY_REPO=1 to opt in.",
          gitStatusBefore,
        ].join("\n"),
      );
    }

    const command = this.options.command ?? "claude";
    const commandLabel = "claude --print --permission-mode bypassPermissions";
    const prompt = createWorkerPrompt(input, gitStatusBefore);
    const args = [
      "--print",
      "--no-session-persistence",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      repoRoot,
      "--system-prompt",
      createWorkerSystemPrompt(),
      prompt,
    ];
    const terminalRun = this.options.openTerminal
      ? await runClaudeInVisibleTerminal({
          command,
          args,
          cwd: repoRoot,
          displayName: input.displayName ?? "Orchestra Claude worker",
          transcriptPath: input.transcriptPath,
          timeoutMs: this.options.timeoutMs,
        })
      : undefined;
    const stdout = terminalRun
      ? terminalRun.stdout
      : (
          await execFileAsync(command, args, {
            cwd: repoRoot,
            maxBuffer: 10 * 1024 * 1024,
            timeout: this.options.timeoutMs ?? 300_000,
          })
        ).stdout;

    const gitStatusAfter = await getGitStatusShort(repoRoot);
    const changedPaths = parseGitStatusPaths(gitStatusAfter);
    const filesChanged = await readChangedTextFiles({
      repoRoot,
      paths: changedPaths,
    });

    return {
      filesChanged,
      notes: String(stdout).trim() || "Claude workspace worker completed.",
      commandsRun: terminalRun
        ? [`${commandLabel} (visible terminal)`, terminalRun.launchCommand]
        : [commandLabel],
      gitStatusBefore,
      gitStatusAfter,
      transcriptPath: terminalRun?.transcriptPath,
    };
  }
}

async function runClaudeInVisibleTerminal(input: {
  command: string;
  args: string[];
  cwd: string;
  displayName: string;
  transcriptPath?: string;
  timeoutMs?: number;
}): Promise<{
  stdout: string;
  transcriptPath: string;
  launchCommand: string;
}> {
  const runDir =
    input.transcriptPath
      ? path.dirname(input.transcriptPath)
      : path.join(os.tmpdir(), "orchestra");
  const safeName = sanitizeFileName(input.displayName);
  const transcriptPath =
    input.transcriptPath ?? path.join(runDir, `${safeName}.claude.log`);
  const scriptPath = path.join(runDir, `${safeName}.claude.ps1`);

  await mkdir(runDir, { recursive: true });
  await writeFile(
    scriptPath,
    createVisibleTerminalScript({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      displayName: input.displayName,
      transcriptPath,
    }),
    "utf8",
  );

  const launcherCommand = createPowerShellStartProcessCommand({
    scriptPath,
    cwd: input.cwd,
  });

  try {
    await execFileAsync("powershell", ["-NoProfile", "-Command", launcherCommand], {
      cwd: input.cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: input.timeoutMs ?? 300_000,
    });
  } catch (error) {
    const transcript = await readTranscript(transcriptPath);
    const details = error as Error & {
      code?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const processOutput = [details.stderr, details.stdout]
      .filter(Boolean)
      .map(String)
      .join("\n")
      .trim();
    const output = [processOutput, transcript].filter(Boolean).join("\n");

    throw new Error(
      output
        ? `Visible Claude terminal failed: ${details.message}\n${output}`
        : `Visible Claude terminal failed: ${details.message}`,
    );
  }

  return {
    stdout: await readTranscript(transcriptPath),
    transcriptPath,
    launchCommand: `powershell -NoProfile -Command ${launcherCommand}`,
  };
}

function createVisibleTerminalScript(input: {
  command: string;
  args: string[];
  cwd: string;
  displayName: string;
  transcriptPath: string;
}): string {
  const argsJson = JSON.stringify(input.args);

  return [
    "$ErrorActionPreference = 'Continue'",
    `$Host.UI.RawUI.WindowTitle = ${toPowerShellString(input.displayName)}`,
    `Set-Location -LiteralPath ${toPowerShellString(input.cwd)}`,
    `$TranscriptPath = ${toPowerShellString(input.transcriptPath)}`,
    "$TranscriptDirectory = Split-Path -Parent $TranscriptPath",
    "New-Item -ItemType Directory -Force -Path $TranscriptDirectory | Out-Null",
    "Clear-Host",
    `Write-Host ${toPowerShellString(input.displayName)}`,
    `Write-Host ${toPowerShellString(`Worktree: ${input.cwd}`)}`,
    `Write-Host ${toPowerShellString(`Transcript: ${input.transcriptPath}`)}`,
    "Write-Host ''",
    `$ClaudeArgs = ConvertFrom-Json @'
${argsJson}
'@`,
    `& ${toPowerShellString(input.command)} @ClaudeArgs | Tee-Object -FilePath $TranscriptPath`,
    "$ExitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }",
    "Write-Host ''",
    "Write-Host \"Claude exited with code $ExitCode\"",
    "Write-Host 'Finished. You may close this window.'",
    "exit $ExitCode",
    "",
  ].join("\n");
}

function createPowerShellStartProcessCommand(input: {
  scriptPath: string;
  cwd: string;
}): string {
  const argumentList = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    input.scriptPath,
  ]
    .map(toPowerShellString)
    .join(", ");

  return [
    `$Process = Start-Process -FilePath 'powershell'`,
    `-ArgumentList @(${argumentList})`,
    `-WorkingDirectory ${toPowerShellString(input.cwd)}`,
    "-Wait -PassThru;",
    "exit $Process.ExitCode",
  ].join(" ");
}

async function readTranscript(transcriptPath: string): Promise<string> {
  try {
    return await readFile(transcriptPath, "utf8");
  } catch {
    return "";
  }
}

function createWorkerSystemPrompt(): string {
  return [
    "You are the builder/worker agent for Orchestra.",
    "You are working inside an existing user-selected git repository.",
    "Make the smallest targeted code changes needed for the request.",
    "Do not revert unrelated existing changes.",
    "Do not write outside the repository.",
    "Prefer following the repository's existing patterns.",
    "When finished, summarize what changed briefly.",
  ].join(" ");
}

function createWorkerPrompt(input: WorkspaceWorkerInput, gitStatusBefore: string): string {
  return [
    `User request:\n${input.request.prompt}`,
    `Planner tasks:\n${JSON.stringify(input.tasks, null, 2)}`,
    `Git status before work:\n${gitStatusBefore || "(clean)"}`,
    "Implement the requested work in this repository.",
  ].join("\n\n");
}

function sanitizeFileName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "orchestra-worker"
  );
}

function toPowerShellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
