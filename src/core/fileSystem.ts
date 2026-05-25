import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectFile, WorkspaceTarget } from "./types";

export const ORCHESTRA_DATA_DIR = path.join(os.homedir(), "Documents", "Orchestra");
export const GENERATED_PROJECTS_DIR = path.join(
  os.homedir(),
  "Desktop",
  "Orchestra Projects",
);

export function getDefaultGeneratedRoot(): string {
  return GENERATED_PROJECTS_DIR;
}

export function createGeneratedProjectWorkspace(
  projectName: string,
  rootDir = GENERATED_PROJECTS_DIR,
): WorkspaceTarget {
  return {
    kind: "generated-project",
    rootPath: rootDir,
    projectName,
  };
}

export function createExistingRepoWorkspace(rootPath: string): WorkspaceTarget {
  return {
    kind: "existing-repo",
    rootPath,
  };
}

export function getWorkspaceRoot(workspace: WorkspaceTarget): string {
  if (workspace.kind === "generated-project") {
    return path.resolve(workspace.rootPath, workspace.projectName);
  }

  return path.resolve(workspace.rootPath);
}

export function getWorkspaceDisplayPath(workspace: WorkspaceTarget): string {
  if (workspace.kind === "generated-project") {
    return path.join(workspace.rootPath, workspace.projectName);
  }

  return path.resolve(workspace.rootPath);
}

export async function writeWorkspaceFile(input: {
  workspace: WorkspaceTarget;
  file: ProjectFile;
}): Promise<string> {
  const workspaceRoot = getWorkspaceRoot(input.workspace);

  const filePath = path.resolve(workspaceRoot, input.file.path);
  assertInside(filePath, workspaceRoot);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.file.content, "utf8");

  return filePath;
}

function assertInside(targetPath: string, allowedRoot: string): void {
  const relativePath = path.relative(allowedRoot, targetPath);
  const isOutside =
    relativePath === "" ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath);

  if (isOutside) {
    throw new Error(`Refusing to write outside ${allowedRoot}: ${targetPath}`);
  }
}
