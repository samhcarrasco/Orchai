import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CompleteJsonInput {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: unknown;
  cwd?: string;
  timeoutMs?: number;
}

export interface LlmClient {
  completeJson<T>(input: CompleteJsonInput): Promise<T>;
}

export class ClaudeCliLlmClient implements LlmClient {
  constructor(
    private readonly options: {
      command?: string;
    } = {},
  ) {}

  async completeJson<T>(input: CompleteJsonInput): Promise<T> {
    const userPrompt = createStructuredUserPrompt(input);
    const args = [
      "--print",
      "--output-format",
      "text",
      "--no-session-persistence",
      "--tools",
      "",
      "--system-prompt",
      input.systemPrompt,
    ];

    if (input.jsonSchema) {
      args.push("--json-schema", JSON.stringify(input.jsonSchema));
    }

    args.push(userPrompt);

    let stdout: string | Buffer;
    try {
      const result = await execFileAsync(
        this.options.command ?? "claude",
        args,
        {
          cwd: input.cwd,
          maxBuffer: 10 * 1024 * 1024,
          timeout: input.timeoutMs ?? 120_000,
        },
      );
      stdout = result.stdout;
    } catch (error) {
      throw new Error(createClaudeErrorMessage(error));
    }

    return parseJsonOutput<T>(String(stdout));
  }
}

function parseJsonOutput<T>(output: string): T {
  const trimmedOutput = output.trim();

  try {
    return unwrapJsonResult<T>(JSON.parse(trimmedOutput));
  } catch {
    const jsonStart = trimmedOutput.indexOf("{");
    const jsonEnd = trimmedOutput.lastIndexOf("}");

    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      return unwrapJsonResult<T>(
        JSON.parse(trimmedOutput.slice(jsonStart, jsonEnd + 1)),
      );
    }

    throw new Error(`Claude did not return valid JSON: ${preview(trimmedOutput)}`);
  }
}

function unwrapJsonResult<T>(value: unknown): T {
  if (
    value &&
    typeof value === "object" &&
    "result" in value &&
    Object.keys(value).length > 1
  ) {
    const result = (value as { result: unknown }).result;

    if (typeof result === "string") {
      return parseJsonOutput<T>(result);
    }

    return result as T;
  }

  return value as T;
}

function createStructuredUserPrompt(input: CompleteJsonInput): string {
  if (!input.jsonSchema) {
    return input.userPrompt;
  }

  return [
    "Return exactly one JSON object and nothing else.",
    "The first character of your response must be { and the last character must be }.",
    "Do not include markdown fences, bullets, explanations, or prose.",
    "The JSON object must match this JSON Schema:",
    JSON.stringify(input.jsonSchema, null, 2),
    "User request:",
    input.userPrompt,
  ].join("\n\n");
}

function createClaudeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & {
      stdout?: string;
      stderr?: string;
    };
    const output = [details.stderr, details.stdout]
      .filter(Boolean)
      .map((value) => preview(String(value)))
      .join("\n");

    return output
      ? `Claude CLI failed: ${error.message}\n${output}`
      : `Claude CLI failed: ${error.message}`;
  }

  return `Claude CLI failed: ${String(error)}`;
}

function preview(value: string): string {
  return value.length > 1_000 ? `${value.slice(0, 1_000)}...` : value;
}
