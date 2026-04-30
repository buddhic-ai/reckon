import { query } from "@anthropic-ai/claude-agent-sdk";
import { env } from "@/lib/env";
import type { RunEvent } from "@/lib/runtime/event-types";
import type { SDKUserMessageLike } from "@/lib/runtime/run-registry";
import { META_SYSTEM_PROMPT } from "./meta-prompt";
import { META_ALLOWED_TOOLS, FIXED_DENY, matches } from "./tool-defaults";
import { workflowBuilderServer } from "./tools/createWorkflow";
import { resolveClaudeBinaryPath } from "./claude-binary";
import type { AskUserFn } from "./runner";

export interface RunMetaAgentOptions {
  userMessages: AsyncIterable<SDKUserMessageLike>;
  emit: (event: RunEvent) => void;
  askUser: AskUserFn;
  abortController?: AbortController;
}

export interface RunMetaAgentResult {
  status: "completed" | "aborted" | "error";
  finalText: string;
  workflowIdSaved?: string;
  totalTokens?: number;
  totalCostUsd?: number;
  errorMessage?: string;
}

export async function runMetaAgent(opts: RunMetaAgentOptions): Promise<RunMetaAgentResult> {
  const { userMessages, emit, askUser } = opts;
  const abortController = opts.abortController ?? new AbortController();
  const costCap = env.costCapUsd();

  emit({ type: "status", text: "Workflow builder ready." });

  const allowed = META_ALLOWED_TOOLS.slice();
  const disallowed = ["Bash", "Write", "Edit", "Agent", ...FIXED_DENY];
  const canUseTool = makeMetaGate(allowed, disallowed, askUser);

  let finalText = "";
  let workflowIdSaved: string | undefined;
  let totalTokens: number | undefined;
  let totalCostUsd: number | undefined;

  try {
    const claudeBinPath = resolveClaudeBinaryPath();
    for await (const message of query({
      prompt: userMessages as AsyncIterable<never>,
      options: {
        systemPrompt: META_SYSTEM_PROMPT,
        model: env.anthropicModel(),
        maxTurns: 30,
        allowedTools: allowed,
        disallowedTools: disallowed,
        mcpServers: { workflow_builder: workflowBuilderServer },
        canUseTool,
        abortController,
        ...(claudeBinPath ? { pathToClaudeCodeExecutable: claudeBinPath } : {}),
      },
    })) {
      const events = sdkMessageToEvents(message);
      for (const ev of events) emit(ev);

      // Capture workflow id from create_workflow tool_result.
      const m = message as Record<string, unknown>;
      if (m.type === "user") {
        const id = extractSavedWorkflowId(m);
        if (id) workflowIdSaved = id;
      }
      if (m.type === "result") {
        finalText = (m.result as string) ?? "";
        if (typeof m.total_cost_usd === "number") totalCostUsd = m.total_cost_usd;
        if (m.usage && typeof m.usage === "object") {
          const u = m.usage as Record<string, unknown>;
          totalTokens =
            ((u.input_tokens as number) ?? 0) +
            ((u.output_tokens as number) ?? 0) +
            ((u.cache_creation_input_tokens as number) ?? 0) +
            ((u.cache_read_input_tokens as number) ?? 0);
        }
        if (m.subtype === "success") {
          emit({ type: "result", ok: true, text: finalText });
        } else {
          emit({
            type: "error",
            stage: "agent",
            message: (m.result as string) ?? "agent error",
          });
        }
        break;
      }

      if (typeof totalCostUsd === "number" && totalCostUsd > costCap) {
        emit({
          type: "error",
          stage: "server",
          message: `Cost cap reached ($${costCap.toFixed(2)}). Aborting.`,
        });
        abortController.abort();
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ type: "error", stage: "agent", message: msg });
    return { status: "error", finalText, errorMessage: msg, totalTokens, totalCostUsd };
  } finally {
    emit({ type: "done" });
  }

  if (abortController.signal.aborted && !finalText) {
    return { status: "aborted", finalText, totalTokens, totalCostUsd };
  }
  return {
    status: "completed",
    finalText,
    workflowIdSaved,
    totalTokens,
    totalCostUsd,
  };
}

// ---------------------------------------------------------------------------

function makeMetaGate(allowed: string[], disallowed: string[], askUser: AskUserFn) {
  let createWorkflowCalls = 0;
  return async (toolName: string, input: Record<string, unknown>) => {
    if (toolName === "AskUserQuestion") {
      return handleAskUserQuestion(input, askUser);
    }
    if (disallowed.some((p) => matches(toolName, p))) {
      return {
        behavior: "deny" as const,
        message: `Tool "${toolName}" is disallowed for the workflow builder. The builder reads schema from lib/agent/knowledge/ via Read; it does not shell out or write files directly. The only side-effecting tool is mcp__workflow_builder__create_workflow.`,
      };
    }
    if (!allowed.some((p) => matches(toolName, p))) {
      return {
        behavior: "deny" as const,
        message: `Tool "${toolName}" not in allowlist. Allowed: ${allowed.join(
          ", "
        )}.`,
      };
    }
    // Idempotency: only let create_workflow fire once per builder run.
    if (toolName === "mcp__workflow_builder__create_workflow") {
      createWorkflowCalls++;
      if (createWorkflowCalls > 1) {
        return {
          behavior: "deny" as const,
          message:
            "create_workflow has already been called for this conversation. Acknowledge the save and end the run.",
        };
      }
    }
    return { behavior: "allow" as const, updatedInput: input };
  };
}

interface SdkAskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
}

async function handleAskUserQuestion(
  input: Record<string, unknown>,
  askUser: AskUserFn
): Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> }> {
  const questions = (input.questions as SdkAskQuestion[] | undefined) ?? [];
  const pairs = await Promise.all(
    questions.map(async (q) => {
      const answer = await askUser({
        question: q.question,
        header: q.header,
        multiSelect: q.multiSelect,
        options: q.options,
      });
      return [q.question, answer] as const;
    })
  );
  const answers: Record<string, string> = {};
  for (const [q, a] of pairs) answers[q] = a;
  return { behavior: "allow", updatedInput: { ...input, answers } };
}

function sdkMessageToEvents(message: unknown): RunEvent[] {
  const m = message as Record<string, unknown>;
  if (m.type === "assistant") {
    const inner = (m.message as { content?: unknown[] } | undefined)?.content ?? [];
    const events: RunEvent[] = [];
    for (const block of inner as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text.length > 0) events.push({ type: "thought", text });
      } else if (block.type === "tool_use") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        events.push({
          type: "tool_call",
          toolUseId: String(block.id ?? ""),
          tool: String(block.name ?? "unknown"),
          summary: summariseToolInput(input),
          argsJson: safeStringify(input),
        });
      }
    }
    return events;
  }
  if (m.type === "user") {
    const inner = (m.message as { content?: unknown[] } | undefined)?.content;
    if (!Array.isArray(inner)) return [];
    const events: RunEvent[] = [];
    for (const block of inner as Array<Record<string, unknown>>) {
      if (block.type === "tool_result") {
        const fullText = extractToolResultText(block.content);
        events.push({
          type: "tool_result",
          toolUseId: String(block.tool_use_id ?? ""),
          ok: !block.is_error,
          summary: fullText.slice(0, 400),
          text: fullText.length > 64 * 1024 ? fullText.slice(0, 64 * 1024) : fullText,
        });
      }
    }
    return events;
  }
  return [];
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

function extractSavedWorkflowId(m: Record<string, unknown>): string | undefined {
  const inner = (m.message as { content?: unknown[] } | undefined)?.content;
  if (!Array.isArray(inner)) return undefined;
  for (const block of inner as Array<Record<string, unknown>>) {
    if (block.type !== "tool_result") continue;
    const text = extractToolResultText(block.content);
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && parsed.ok === true) {
        const id = (parsed as Record<string, unknown>).workflowId;
        if (typeof id === "string") return id;
      }
    } catch {
      /* ignore non-JSON results */
    }
  }
  return undefined;
}

function summariseToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const entries = Object.entries(input as Record<string, unknown>);
  const out = entries.map(([k, v]) => {
    if (Array.isArray(v)) return `${k}=[${v.length} items]`;
    if (typeof v === "string" && v.length > 60)
      return `${k}=${JSON.stringify(v.slice(0, 57) + "...")}`;
    return `${k}=${JSON.stringify(v)}`;
  });
  const line = out.join(" ");
  return line.length > 240 ? line.slice(0, 237) + "..." : line;
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const cb = c as Record<string, unknown>;
        return cb.type === "text" && typeof cb.text === "string" ? cb.text : "";
      })
      .join("");
  }
  return "";
}
