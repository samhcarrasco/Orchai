# Step 09: Real LLM Upgrade

## Goal

Add the first optional real LLM-powered planner path while keeping the deterministic planner as the default.

## Teacher Explanation

An LLM should be treated as one replaceable part of the system, not the whole system.

The workflow should still be:

```txt
Prompt -> Planner -> Tasks -> Builder -> Files -> Reviewer -> Feedback
```

The only change is how the planner creates tasks.

That is why we build the deterministic planner first. It proves the architecture before we add API keys, model choices, token costs, and JSON parsing issues.

## What We Will Create

When we work on this step, we create:

```txt
src/core/
  llmClient.ts
```

## LLM Client Interface

```ts
export interface LlmClient {
  completeJson<T>(input: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<T>;
}
```

## Why Use An Interface

The planner should not care which AI provider is used.

It should only care that it can ask for structured JSON and receive the expected shape back.

## Preferred Provider Direction

The first real LLM upgrade should prefer using an AI CLI that is already logged in on the local machine, such as Claude Code or an OpenAI terminal tool, instead of starting with direct API key integration.

The app should not hardcode those terminal commands directly inside the planner or orchestrator. Instead, the planner should call a replaceable client such as:

```ts
llmClient.completeJson(...)
```

Then one implementation can shell out to a local AI CLI:

```txt
PlannerAgent
  -> TerminalLlmClient
    -> claude/openai CLI command
```

This keeps the workflow flexible. The planner output shape should stay the same whether it came from deterministic TypeScript logic, Claude CLI, OpenAI CLI, a direct API call, or another local model.

The important contract to protect is:

```ts
{
  projectName: string;
  tasks: Task[];
}
```

## First Provider: Claude CLI

The first provider is the local Claude CLI.

Orchestra should still run normally without Claude:

```bash
npm run dev -- "Build a simple todo app"
```

Claude should only be used intentionally:

```powershell
$env:ORCHESTRA_PLANNER = "claude"
npm run dev -- "Build a simple todo app"
```

The Claude client should:

- call `claude --print` for non-interactive output
- pass a planner system prompt
- request JSON that matches `PlannerOutput`
- parse the JSON response
- fail with a useful error if Claude returns invalid JSON

The deterministic planner should remain available:

```powershell
$env:ORCHESTRA_PLANNER = "deterministic"
```

## Implementation Tasks

1. Add an `LlmClient` interface.
2. Keep the deterministic planner as the default.
3. Add an optional LLM planner mode.
4. Validate that the LLM still returns `PlannerOutput`.
5. Keep builder and reviewer rule-based at first.

## Acceptance Criteria

This step is complete when:

- The mock planner still works.
- The LLM planner can be enabled intentionally.
- The planner output shape does not change.
- Bad LLM JSON does not crash the whole system without a useful error.

## Check Before Moving On

Ask yourself:

- Can I switch back to the mock planner easily?
- Does the LLM return the same shape as the deterministic planner?
- Is the log clear enough to debug bad AI output?

## Common Mistakes

- Adding an LLM before the local workflow works.
- Letting the LLM return unstructured text.
- Replacing every agent with AI at once.
