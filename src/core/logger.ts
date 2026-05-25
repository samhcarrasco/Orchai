import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentLogEntry, RunLog } from "./types";

type LogInput = Omit<AgentLogEntry, "timestamp" | "runId">;
export const DEFAULT_RUNS_DIR = path.join(
  os.homedir(),
  "Documents",
  "Orchestra",
  "runs",
);

export class RunLogger {
  private readonly entries: AgentLogEntry[] = [];

  constructor(
    public readonly runId: string = createRunId(),
    private readonly runsDir = DEFAULT_RUNS_DIR,
  ) {}

  log(input: LogInput): AgentLogEntry {
    const entry: AgentLogEntry = {
      timestamp: new Date().toISOString(),
      runId: this.runId,
      ...input,
    };

    this.entries.push(entry);
    return entry;
  }

  async save(): Promise<string> {
    await mkdir(this.runsDir, { recursive: true });

    const filePath = path.join(this.runsDir, `${this.runId}.json`);
    const runLog: RunLog = {
      runId: this.runId,
      entries: this.entries,
    };

    await writeFile(filePath, `${JSON.stringify(runLog, null, 2)}\n`, "utf8");
    return filePath;
  }
}

export function createRunId(prefix = "run"): string {
  return `${prefix}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}
