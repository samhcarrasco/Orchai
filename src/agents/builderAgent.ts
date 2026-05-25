import { writeWorkspaceFile } from "../core/fileSystem";
import type { BuilderInput, BuilderOutput, ProjectFile, Task } from "../core/types";
import type { WorkspaceWorker } from "../core/workspaceWorker";

export class BuilderAgent {
  constructor(
    private readonly options: {
      existingRepoWorker?: WorkspaceWorker;
    } = {},
  ) {}

  async build(input: BuilderInput): Promise<BuilderOutput> {
    if (input.projectState.workspace.kind === "existing-repo") {
      if (!this.options.existingRepoWorker) {
        throw new Error(
          "Existing repo work requires a workspace worker. Set ORCHESTRA_PLANNER=claude for now.",
        );
      }

      return this.options.existingRepoWorker.run({
        request: input.projectState.userRequest,
        tasks: input.tasks,
        workspace: input.projectState.workspace,
        displayName: input.workerDisplayName,
        transcriptPath: input.workerTranscriptPath,
      });
    }

    const filesChanged: ProjectFile[] = [];

    for (const task of input.tasks) {
      for (const targetFile of task.targetFiles) {
        const file = createProjectFile({
          projectName: input.projectState.projectName,
          targetFile,
          task,
        });

        await writeWorkspaceFile({
          workspace: input.projectState.workspace,
          file,
        });

        filesChanged.push(file);
      }
    }

    return {
      filesChanged,
      notes: `Created ${filesChanged.length} file(s) for ${input.projectState.projectName}.`,
    };
  }
}

function createProjectFile(input: {
  projectName: string;
  targetFile: string;
  task: Task;
}): ProjectFile {
  const fileName = getFileName(input.targetFile);

  if (input.projectName === "simple-todo-app") {
    return {
      path: input.targetFile,
      content: createTodoFileContent(fileName),
    };
  }

  return {
    path: input.targetFile,
    content: createStaticSiteFileContent(fileName, input.task),
  };
}

function getFileName(filePath: string): string {
  return filePath.replaceAll("\\", "/").split("/").at(-1) ?? filePath;
}

function createTodoFileContent(fileName: string): string {
  switch (fileName) {
    case "index.html":
      return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Simple Todo App</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="app">
      <h1>Todo List</h1>
      <form id="todo-form" class="todo-form">
        <input id="todo-input" type="text" placeholder="Add a task" />
        <button type="submit">Add</button>
      </form>
      <ul id="todo-list" class="todo-list"></ul>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`;

    case "styles.css":
      return `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: Arial, sans-serif;
  background: #f4f7fb;
  color: #1f2937;
}

.app {
  width: min(92vw, 420px);
  padding: 24px;
  background: white;
  border: 1px solid #d8dee9;
  border-radius: 8px;
}

.todo-form {
  display: flex;
  gap: 8px;
}

.todo-form input {
  flex: 1;
  padding: 10px;
}

.todo-form button {
  padding: 10px 14px;
}

.todo-list {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
}

.todo-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid #e5e7eb;
}

.todo-list li.done span {
  text-decoration: line-through;
  color: #6b7280;
}
`;

    case "app.js":
      return `const form = document.querySelector("#todo-form");
const input = document.querySelector("#todo-input");
const list = document.querySelector("#todo-list");

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text) {
    return;
  }

  const item = document.createElement("li");
  const label = document.createElement("span");
  const removeButton = document.createElement("button");

  label.textContent = text;
  removeButton.type = "button";
  removeButton.textContent = "Remove";

  label.addEventListener("click", () => {
    item.classList.toggle("done");
  });

  removeButton.addEventListener("click", () => {
    item.remove();
  });

  item.append(label, removeButton);
  list.append(item);
  input.value = "";
  input.focus();
});
`;

    default:
      return createPlaceholderContent(fileName);
  }
}

function createStaticSiteFileContent(fileName: string, task: Task): string {
  switch (fileName) {
    case "index.html":
      return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Static Site</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>Static Site</h1>
      <p>${task.description}</p>
    </main>
  </body>
</html>
`;

    case "styles.css":
      return `body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: #f6f8fa;
  color: #24292f;
}

main {
  max-width: 720px;
  margin: 80px auto;
  padding: 0 24px;
}
`;

    default:
      return createPlaceholderContent(fileName);
  }
}

function createPlaceholderContent(fileName: string): string {
  return `Generated placeholder for ${fileName}.
`;
}
