import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  contextBrief?: string;
}

export interface WorkspaceWorker {
  run(input: WorkspaceWorkerInput): Promise<BuilderOutput>;
}

export class ClaudeCliWorkspaceWorker implements WorkspaceWorker {
  constructor(
    private readonly options: {
      command?: string;
      model?: string;
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
    const useStreamingTerminal = Boolean(this.options.openTerminal);
    const modelLabel = this.options.model ? ` --model ${this.options.model}` : "";
    const commandLabel = useStreamingTerminal
      ? `claude${modelLabel} --print --output-format stream-json --verbose --permission-mode bypassPermissions`
      : `claude${modelLabel} --print --permission-mode bypassPermissions`;
    const prompt = createWorkerPrompt(input, gitStatusBefore);
    const modelArgs = this.options.model ? ["--model", this.options.model] : [];
    const baseArgs = [
      "--print",
      "--no-session-persistence",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      repoRoot,
      "--system-prompt",
      createWorkerSystemPrompt(),
      ...modelArgs,
      prompt,
    ];
    const args = useStreamingTerminal
      ? ["--output-format", "stream-json", "--verbose", ...baseArgs]
      : baseArgs;
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
  const basePath = transcriptPath.replace(/\.log$/i, "") || transcriptPath;
  const scriptPath = `${basePath}.ps1`;
  const sentinelPath = `${basePath}.done`;

  await mkdir(runDir, { recursive: true });
  await rm(sentinelPath, { force: true });
  await rm(transcriptPath, { force: true });
  await writeFile(
    scriptPath,
    createVisibleTerminalScript({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      displayName: input.displayName,
      transcriptPath,
      sentinelPath,
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
      timeout: 30_000,
    });
  } catch (error) {
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

    throw new Error(
      processOutput
        ? `Visible Claude terminal launch failed: ${details.message}\n${processOutput}`
        : `Visible Claude terminal launch failed: ${details.message}`,
    );
  }

  const exitCode = await waitForSentinel({
    sentinelPath,
    timeoutMs: input.timeoutMs ?? 300_000,
  });

  const stdout = await readTranscript(transcriptPath);

  if (exitCode !== 0) {
    const transcriptTail = stdout.slice(-2_000).trim();
    throw new Error(
      transcriptTail
        ? `Visible Claude terminal exited with code ${exitCode} (transcript: ${transcriptPath})\n${transcriptTail}`
        : `Visible Claude terminal exited with code ${exitCode} (transcript: ${transcriptPath})`,
    );
  }

  return {
    stdout,
    transcriptPath,
    launchCommand: `powershell -NoProfile -Command ${launcherCommand}`,
  };
}

async function waitForSentinel(input: {
  sentinelPath: string;
  timeoutMs: number;
}): Promise<number> {
  const pollIntervalMs = 1000;
  const startedAt = Date.now();

  while (true) {
    try {
      const rawExitCode = (await readFile(input.sentinelPath, "utf8")).trim();
      if (rawExitCode.length > 0) {
        const exitCode = Number.parseInt(rawExitCode, 10);
        return Number.isNaN(exitCode) ? 1 : exitCode;
      }
    } catch {
      // sentinel not yet present
    }

    if (Date.now() - startedAt > input.timeoutMs) {
      throw new Error(
        `Visible Claude terminal did not finish within ${input.timeoutMs}ms (sentinel missing: ${input.sentinelPath})`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

function createVisibleTerminalScript(input: {
  command: string;
  args: string[];
  cwd: string;
  displayName: string;
  transcriptPath: string;
  sentinelPath: string;
}): string {
  const argsJson = JSON.stringify(input.args);

  return [
    "$ErrorActionPreference = 'Continue'",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$Host.UI.RawUI.WindowTitle = ${toPowerShellString(input.displayName)}`,
    `Set-Location -LiteralPath ${toPowerShellString(input.cwd)}`,
    `$TranscriptPath = ${toPowerShellString(input.transcriptPath)}`,
    `$SentinelPath = ${toPowerShellString(input.sentinelPath)}`,
    "$TranscriptDirectory = Split-Path -Parent $TranscriptPath",
    "New-Item -ItemType Directory -Force -Path $TranscriptDirectory | Out-Null",
    "Clear-Host",
    `Write-Host ${toPowerShellString(input.displayName)} -ForegroundColor White`,
    `Write-Host ${toPowerShellString(`Worktree: ${input.cwd}`)} -ForegroundColor DarkGray`,
    `Write-Host ${toPowerShellString(`Transcript: ${input.transcriptPath}`)} -ForegroundColor DarkGray`,
    "Write-Host ''",
    "function Write-Line {",
    "    param([string]$Text, [string]$Color)",
    "    if ($Color) { Write-Host $Text -ForegroundColor $Color } else { Write-Host $Text }",
    "    Add-Content -LiteralPath $TranscriptPath -Value $Text -Encoding utf8",
    "}",
    "function Truncate-Text {",
    "    param([string]$Text, [int]$Max = 240)",
    "    if (-not $Text) { return '' }",
    "    if ($Text.Length -le $Max) { return $Text }",
    "    return $Text.Substring(0, $Max) + '...'",
    "}",
    "function Format-ClaudeEvent {",
    "    param($Event)",
    "    if (-not $Event) { return }",
    "    switch ($Event.type) {",
    "        'system' {",
    "            if ($Event.subtype -eq 'init') {",
    "                $model = if ($Event.model) { $Event.model } else { 'unknown' }",
    "                Write-Line \"[session] model=$model\" 'DarkGray'",
    "            }",
    "        }",
    "        'assistant' {",
    "            $content = $Event.message.content",
    "            if (-not $content) { return }",
    "            foreach ($block in $content) {",
    "                switch ($block.type) {",
    "                    'text' {",
    "                        if ($block.text) { Write-Line $block.text 'White' }",
    "                    }",
    "                    'tool_use' {",
    "                        $argsText = ''",
    "                        try { $argsText = ($block.input | ConvertTo-Json -Compress -Depth 4) } catch { $argsText = '' }",
    "                        $argsText = Truncate-Text $argsText 240",
    "                        Write-Line \"[tool: $($block.name)] $argsText\" 'Cyan'",
    "                    }",
    "                    'thinking' {",
    "                        $preview = Truncate-Text $block.thinking 160",
    "                        Write-Line \"[thinking] $preview\" 'DarkYellow'",
    "                    }",
    "                }",
    "            }",
    "        }",
    "        'user' {",
    "            $content = $Event.message.content",
    "            if (-not $content) { return }",
    "            foreach ($block in $content) {",
    "                if ($block.type -eq 'tool_result') {",
    "                    $status = if ($block.is_error) { 'error' } else { 'ok' }",
    "                    $color = if ($block.is_error) { 'Red' } else { 'DarkCyan' }",
    "                    $preview = ''",
    "                    if ($block.content -is [string]) {",
    "                        $preview = Truncate-Text $block.content 160",
    "                    } elseif ($block.content) {",
    "                        try { $preview = Truncate-Text (($block.content | ConvertTo-Json -Compress -Depth 3)) 160 } catch { $preview = '' }",
    "                    }",
    "                    Write-Line \"[tool result: $status] $preview\" $color",
    "                }",
    "            }",
    "        }",
    "        'result' {",
    "            Write-Line '' $null",
    "            $status = if ($Event.is_error) { 'error' } else { 'ok' }",
    "            $color = if ($Event.is_error) { 'Red' } else { 'Green' }",
    "            $cost = ''",
    "            if ($Event.total_cost_usd) {",
    "                $rounded = [math]::Round([double]$Event.total_cost_usd, 4)",
    "                $cost = \" cost=`$$rounded\"",
    "            }",
    "            $duration = if ($Event.duration_ms) { \" duration=$($Event.duration_ms)ms\" } else { '' }",
    "            Write-Line \"[done $status$duration$cost]\" $color",
    "            if ($Event.result) { Write-Line $Event.result 'White' }",
    "        }",
    "    }",
    "}",
    `$ClaudeArgs = ConvertFrom-Json @'
${argsJson}
'@`,
    "$HadError = $false",
    "try {",
    `    & ${toPowerShellString(input.command)} @ClaudeArgs | ForEach-Object {`,
    "        $rawLine = $_",
    "        if ([string]::IsNullOrWhiteSpace($rawLine)) { return }",
    "        $parsed = $null",
    "        if ($rawLine.TrimStart().StartsWith('{')) {",
    "            try { $parsed = $rawLine | ConvertFrom-Json -ErrorAction Stop } catch { $parsed = $null }",
    "        }",
    "        if ($parsed -and $parsed.type) {",
    "            Format-ClaudeEvent $parsed",
    "        } else {",
    "            Write-Line $rawLine $null",
    "        }",
    "    }",
    "} catch {",
    "    $HadError = $true",
    "    Write-Line \"[error] $($_.Exception.Message)\" 'Red'",
    "} finally {",
    "    $ExitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }",
    "    if ($HadError -and $ExitCode -eq 0) { $ExitCode = 1 }",
    "    Write-Host ''",
    "    Write-Host \"Claude exited with code $ExitCode\" -ForegroundColor DarkGray",
    "    Set-Content -LiteralPath $SentinelPath -Value $ExitCode -Encoding utf8",
    "    Write-Host 'Press Enter to close this window.' -ForegroundColor DarkGray",
    "    [void](Read-Host)",
    "    exit $ExitCode",
    "}",
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
    `Start-Process -FilePath 'powershell'`,
    `-ArgumentList @(${argumentList})`,
    `-WorkingDirectory ${toPowerShellString(input.cwd)} | Out-Null`,
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
    "The current working directory is the selected repository or worktree and is the only writable repository root.",
    "Make the smallest targeted code changes needed for the request.",
    "Do not revert unrelated existing changes.",
    "Do not write outside the repository.",
    "If instructions mention another absolute path, reinterpret them relative to the current working directory instead of using that path.",
    "Do not use tool calls that read, write, or execute commands outside the current working directory.",
    "Prefer following the repository's existing patterns.",
    "Do not run any git commands (add, commit, push, stash, etc.).",
    "When finished, summarize what changed briefly.",
  ].join(" ");
}

function createWorkerPrompt(input: WorkspaceWorkerInput, gitStatusBefore: string): string {
  const repoRoot = getWorkspaceRoot(input.workspace);

  return [
    `Current workspace root:\n${repoRoot}`,
    "This is the only repository path you may inspect or edit.",
    "If the user request or planner tasks mention another checkout path, ignore that path and apply the requested change here.",
    `User request:\n${input.request.prompt}`,
    input.contextBrief ? `Planner brief:\n${input.contextBrief}` : undefined,
    `Planner tasks:\n${JSON.stringify(input.tasks, null, 2)}`,
    `Git status before work:\n${gitStatusBefore || "(clean)"}`,
    "Implement the requested work in this repository.",
  ]
    .filter(Boolean)
    .join("\n\n");
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
