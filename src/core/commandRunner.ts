import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandResult } from "./types";

const execFileAsync = promisify(execFile);

export async function runProcessCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: input.timeoutMs ?? 300_000,
    });

    return {
      command: formatCommand(input.command, input.args),
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
      command: formatCommand(input.command, input.args),
      exitCode: typeof details.code === "number" ? details.code : 1,
      stdout: String(details.stdout ?? ""),
      stderr: String(details.stderr || details.message || ""),
    };
  }
}

export async function runReviewCommand(input: {
  command: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", input.command],
      {
        cwd: input.cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: input.timeoutMs ?? 300_000,
      },
    );

    return {
      command: input.command,
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
      command: input.command,
      exitCode: typeof details.code === "number" ? details.code : 1,
      stdout: String(details.stdout ?? ""),
      stderr: String(details.stderr ?? details.message),
    };
  }
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteArg).join(" ");
}

function quoteArg(arg: string): string {
  return /\s/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}
