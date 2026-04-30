import { query } from "@anthropic-ai/claude-agent-sdk";
import { env } from "@/lib/env";
import type { Workflow } from "@/lib/workflow/schema";
import type { RunEvent } from "@/lib/runtime/event-types";
import type { SDKUserMessageLike } from "@/lib/runtime/run-registry";
import { buildSystemPrompt } from "./runner-prompt";
import {
  DEFAULT_ALLOWED_TOOLS,
  FIXED_DENY,
  inspectBashForGraphjinMutations,
  matches,
} from "./tool-defaults";
import { buildPresentServer } from "./tools/present";
import { workflowBuilderServer } from "./tools/createWorkflow";

export interface AskUserQuestionInput {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
}

export type AskUserFn = (q: AskUserQuestionInput) => Promise<string>;

/**
 * Sentinel error raised by the headless askUser. The runner catches it and
 * surfaces a 'needs_input' status to the caller without bubbling up as a
 * generic error.
 */
export class HeadlessNeedsInputError extends Error {
  constructor(message?: string) {
    super(message ?? "Workflow paused awaiting operator input");
    this.name = "HeadlessNeedsInputError";
  }
}

/** Build the askUser fn used in headless mode. First call aborts the run. */
export function makeHeadlessAskUser(abortController: AbortController): AskUserFn {
  let fired = false;
  return async () => {
    if (!fired) {
      fired = true;
      abortController.abort();
    }
    throw new HeadlessNeedsInputError();
  };
}

export interface RunWorkflowResult {
  status: "completed" | "aborted" | "error" | "needs_input";
  finalText: string;
  totalTokens?: number;
  totalCostUsd?: number;
  errorMessage?: string;
}

export interface RunWorkflowOptions {
  workflow: Workflow;
  userMessages: AsyncIterable<SDKUserMessageLike>;
  emit: (event: RunEvent) => void;
  askUser: AskUserFn;
  abortController?: AbortController;
  mode: "live" | "headless";
  /**
   * Optional preformatted history block. When set, it's appended to the
   * system prompt so the model has prior chat context. Used by /api/run to
   * carry the last 30 turns of a chat into a fresh SDK invocation.
   */
  priorHistory?: string;
}

/**
 * Run a saved workflow against the Claude Agent SDK. Translates SDK messages
 * into the project's RunEvent stream and emits them via opts.emit.
 */
export async function runWorkflow(opts: RunWorkflowOptions): Promise<RunWorkflowResult> {
  const { workflow, userMessages, emit, askUser, mode } = opts;
  const abortController = opts.abortController ?? new AbortController();
  const costCap = env.costCapUsd();

  const allowed = (workflow.allowedTools ?? DEFAULT_ALLOWED_TOOLS).slice();
  const disallowed = [
    ...(workflow.disallowedTools ?? []),
    ...FIXED_DENY,
  ];

  emit({ type: "status", text: `Starting "${workflow.name}".` });

  const canUseTool = makeGate(allowed, disallowed, askUser);
  const uiServer = buildPresentServer(emit);

  let finalText = "";
  let totalTokens: number | undefined;
  let totalCostUsd: number | undefined;
  let needsInput = false;

  const baseSystemPrompt = buildSystemPrompt(workflow, mode);
  const fullSystemPrompt = opts.priorHistory
    ? `${baseSystemPrompt}\n\n--- EARLIER IN THIS CONVERSATION ---\n${opts.priorHistory}\n--- END HISTORY ---`
    : baseSystemPrompt;

  try {
    for await (const message of query({
      prompt: userMessages as AsyncIterable<never>,
      options: {
        systemPrompt: fullSystemPrompt,
        model: env.anthropicModel(),
        maxTurns: 50,
        allowedTools: allowed,
        disallowedTools: disallowed,
        mcpServers: { ui: uiServer, workflow_builder: workflowBuilderServer },
        canUseTool,
        abortController,
      },
    })) {
      const events = sdkMessageToEvents(message);
      for (const ev of events) emit(ev);

      const m = message as Record<string, unknown>;
      if (m.type === "result") {
        const sub = m.subtype;
        finalText = (m.result as string) ?? "";
        if (typeof m.total_cost_usd === "number") totalCostUsd = m.total_cost_usd;
        if (m.usage && typeof m.usage === "object") {
          const u = m.usage as Record<string, unknown>;
          const ti = (u.input_tokens as number) ?? 0;
          const to = (u.output_tokens as number) ?? 0;
          const ct = (u.cache_creation_input_tokens as number) ?? 0;
          const cr = (u.cache_read_input_tokens as number) ?? 0;
          totalTokens = ti + to + ct + cr;
        }
        if (sub === "success") {
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

      // Cost-cap circuit breaker.
      if (typeof totalCostUsd === "number" && totalCostUsd > costCap) {
        emit({
          type: "error",
          stage: "server",
          message: `Cost cap reached ($${costCap.toFixed(2)}). Aborting run.`,
        });
        abortController.abort();
        break;
      }
    }
  } catch (err) {
    if (err instanceof HeadlessNeedsInputError) {
      needsInput = true;
      emit({
        type: "error",
        stage: "agent",
        message:
          "This workflow asked the operator a question, but no operator is present (scheduled run). Run it manually to continue.",
      });
    } else if ((err as Error)?.name === "AbortError") {
      // already emitted an error event upstream
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", stage: "agent", message: msg });
      return {
        status: "error",
        finalText,
        totalTokens,
        totalCostUsd,
        errorMessage: msg,
      };
    }
  } finally {
    emit({ type: "done" });
  }

  if (needsInput) {
    return {
      status: "needs_input",
      finalText,
      totalTokens,
      totalCostUsd,
      errorMessage: "Workflow paused awaiting operator input",
    };
  }

  if (abortController.signal.aborted && !finalText) {
    return {
      status: "aborted",
      finalText,
      totalTokens,
      totalCostUsd,
    };
  }

  return {
    status: "completed",
    finalText,
    totalTokens,
    totalCostUsd,
  };
}

// ---------------------------------------------------------------------------
// canUseTool gate
// ---------------------------------------------------------------------------

function makeGate(allowed: string[], disallowed: string[], askUser: AskUserFn) {
  let saveCalls = 0;
  return async (toolName: string, input: Record<string, unknown>) => {
    if (toolName === "AskUserQuestion") {
      return handleAskUserQuestion(input, askUser);
    }
    if (disallowed.some((p) => matches(toolName, p))) {
      return {
        behavior: "deny" as const,
        message: `Tool "${toolName}" is disallowed by this workflow.`,
      };
    }
    if (!allowed.some((p) => matches(toolName, p))) {
      return {
        behavior: "deny" as const,
        message: `Tool "${toolName}" is not in this workflow's allowlist. Allowed tools: ${allowed.join(
          ", "
        )}. Continue using only those.`,
      };
    }
    if (toolName === "Bash") {
      const cmd = (input?.command as string) ?? "";
      const denial = inspectBashForGraphjinMutations(cmd);
      if (denial) {
        return { behavior: "deny" as const, message: denial };
      }
    }
    if (toolName === "mcp__workflow_builder__create_workflow") {
      // Per-run idempotency: at most one save per SDK invocation.
      saveCalls++;
      if (saveCalls > 1) {
        return {
          behavior: "deny" as const,
          message:
            "create_workflow already fired in this turn. Acknowledge the save and stop.",
        };
      }
      // Mandatory user confirmation. Build a human-readable summary, ask, deny on cancel.
      const denial = await confirmSaveWorkflow(input, askUser);
      if (denial) return { behavior: "deny" as const, message: denial };
    }
    return { behavior: "allow" as const, updatedInput: input };
  };
}

/**
 * Build a human-readable summary of a pending workflow save and ask the user
 * to confirm. Returns a denial string if the user cancels, null if approved.
 */
async function confirmSaveWorkflow(
  input: Record<string, unknown>,
  askUser: AskUserFn
): Promise<string | null> {
  const name = String(input.name ?? "(unnamed)");
  const description = String(input.description ?? "");
  const triggers = (input.triggers ?? {}) as {
    cron?: string;
    timezone?: string;
    enabled?: boolean;
  };
  const steps = ((input.steps ?? []) as Array<{ description?: string }>)
    .map((s, i) => `${i + 1}. ${s.description ?? ""}`)
    .join("\n");
  let existingNote = "";
  try {
    const { getWorkflowByName } = await import("@/lib/db/workflows");
    if (getWorkflowByName(name)) {
      existingNote = ` (updates existing — a workflow named "${name}" already exists)`;
    }
  } catch {
    // best-effort lookup
  }
  const cronLine = triggers.cron
    ? `Schedule: ${triggers.cron} (${triggers.timezone ?? "UTC"}${
        triggers.enabled === false ? ", disabled" : ""
      })`
    : "Schedule: on-demand (no cron)";

  const summary =
    `**Save this workflow?**${existingNote}\n\n` +
    `**Name:** ${name}\n` +
    `**Description:** ${description}\n` +
    `${cronLine}\n` +
    `**Steps:**\n${steps || "(none)"}`;

  const answer = await askUser({
    header: "Confirm workflow save",
    question: summary,
    options: [
      { label: "Yes, save", description: "Persist this workflow." },
      { label: "Cancel", description: "Don't save; tell me what to change." },
    ],
  });
  const normalized = answer.trim().toLowerCase();
  if (
    normalized.startsWith("yes") ||
    normalized === "save" ||
    normalized.includes("yes, save")
  ) {
    return null;
  }
  return "User declined the save. Ask what to change before trying again.";
}

interface SdkAskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
}

/**
 * Intercept AskUserQuestion: collect each question's answer via opts.askUser
 * and inject the answers map into the tool's input. The agent then receives
 * the answers as if the tool had run.
 */
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

// ---------------------------------------------------------------------------
// SDK message → RunEvent translation
// ---------------------------------------------------------------------------

const MAX_TOOL_TEXT_BYTES = 64 * 1024;

function sdkMessageToEvents(message: unknown): RunEvent[] {
  const m = message as Record<string, unknown>;
  if (m.type === "assistant") {
    const inner = (m.message as { content?: unknown[] } | undefined)?.content ?? [];
    const events: RunEvent[] = [];
    for (const block of inner as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text.length > 0) {
          events.push({ type: "thought", text });
        }
      } else if (block.type === "tool_use") {
        const name = String(block.name ?? "unknown");
        const input = (block.input ?? {}) as Record<string, unknown>;
        // The present tool's input is replayed verbatim by the surface event;
        // keep the tool_call entry compact to avoid double-storing payloads.
        const isPresent = name === "mcp__ui__present";
        events.push({
          type: "tool_call",
          toolUseId: String(block.id ?? ""),
          tool: name,
          summary: isPresent ? "rendering surface…" : formatToolArgs(input),
          argsJson: isPresent ? undefined : safeStringify(input),
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
        const ok = !block.is_error;
        const fullText = extractToolResultText(block.content);
        const capped =
          fullText.length > MAX_TOOL_TEXT_BYTES
            ? fullText.slice(0, MAX_TOOL_TEXT_BYTES) + `\n…(+${fullText.length - MAX_TOOL_TEXT_BYTES} bytes truncated)`
            : fullText;
        events.push({
          type: "tool_result",
          toolUseId: String(block.tool_use_id ?? ""),
          ok,
          summary: fullText.slice(0, 400),
          text: capped,
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

function formatToolArgs(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const entries = Object.entries(input as Record<string, unknown>).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}=[${v.length} items]`;
    if (typeof v === "string" && v.length > 60)
      return `${k}=${JSON.stringify(v.slice(0, 57) + "...")}`;
    return `${k}=${JSON.stringify(v)}`;
  });
  const line = entries.join(" ");
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
