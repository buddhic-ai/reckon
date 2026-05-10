/**
 * Auto-memory pipeline. Runs after a successful run (chat turn or workflow
 * run) and decides whether the just-finished turn yielded anything worth
 * remembering across future sessions.
 *
 * Two stages:
 *   1. classifyTurnForMemory — small Claude call that turns
 *      {userMessage, agentAnswer} into 0-3 typed memory drafts with a
 *      confidence score.
 *   2. dispatchMemoryDrafts  — pure DB-side function that decides per draft:
 *        - high confidence + no scope conflict + AGENT_AUTO_MEMORY=on → write
 *          straight to `memories`
 *        - everything else (low confidence, conflicts, or propose-mode) → row
 *          in `pending_memories` for the operator to accept/decline
 *
 * The classifier is split from the dispatcher so the smoke test can exercise
 * the routing rules without making a real network call.
 */
import { env } from "@/lib/env";
import {
  MEMORY_KINDS,
  findConflictingMemories,
  normalizeNewMemoryScope,
  rememberMemory,
  type Memory,
  type MemoryKind,
  type MemoryScope,
} from "@/lib/db/memories";
import {
  createPendingMemory,
  type PendingMemory,
  type PendingMemoryConflict,
} from "@/lib/db/pendingMemories";

export interface ClassifierContext {
  /** Workflow being run (always present — even chats run a workflow). */
  workflowId: string;
  /** Chat surface, when running a chat turn. Absent for headless workflow runs. */
  chatId?: string | null;
  /** Run id of the just-completed run. Always present. */
  runId: string;
}

export interface MemoryDraft {
  text: string;
  kind: MemoryKind;
  scope: MemoryScope;
  scopeId?: string | null;
  confidence: number;
  reasoning?: string;
}

export interface ClassifierInput extends ClassifierContext {
  userMessage: string;
  agentAnswer: string;
}

export interface DispatchResult {
  saved: Memory[];
  pending: PendingMemory[];
  skipped: Array<{ draft: MemoryDraft; reason: string }>;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const MIN_DRAFT_CONFIDENCE = 0.6;

const CLASSIFIER_SYSTEM_PROMPT = `You are an auto-memory classifier for an analytics agent.

Given the user's most recent message and the agent's reply, decide whether the
turn produced any STABLE facts worth remembering for future sessions.

Memorable signals:
- Stable preferences: "always show revenue in INR lakhs", "prefer concise answers"
- Business rules: "exclude orders from acme.test", "don't include test customers"
- Metric definitions: "active customer = ordered in last 90 days"
- Corrections that imply a permanent rule: "no, sales should be net of returns"
- Company context: "we report in fiscal year starting April"

Do NOT propose memories for:
- One-off filters scoped to the current question only ("for this report only", "this once")
- Trivia, ad-hoc clarifications, or question rephrasings
- Findings, numbers, or analysis output (those live in run history, not memory)
- Anything the user explicitly asked you to forget

Output via the propose_memories tool. For each draft, set confidence:
- 0.9-1.0 only when language is unambiguous ("always", "never", "from now on")
- 0.6-0.85 for clear-but-scoped rules ("for this chat we treat X as Y")
- 0.4-0.6 for plausible-but-ambiguous statements — do NOT include these as drafts
- Below 0.6: do not include the draft at all

When you do emit a draft, only use these scopes:
- "global" for durable rules that should apply everywhere
- "chat" for local context that should only apply to this conversation

Do NOT use "workflow" scope.

Return at most 3 drafts. Empty array is the right answer most of the time.`;

interface ClassifierOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Call the small classifier model. Returns 0-3 drafts. Errors are swallowed
 * upstream so a flaky network call never breaks the user-facing turn.
 */
export async function classifyTurnForMemory(
  input: ClassifierInput,
  options: ClassifierOptions = {}
): Promise<MemoryDraft[]> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const model = options.model ?? env.autoMemoryClassifierModel();
  const fetchImpl = options.fetchImpl ?? fetch;

  const userBlock = [
    `USER MESSAGE:\n${truncate(input.userMessage, 4000)}`,
    `\nAGENT ANSWER:\n${truncate(input.agentAnswer, 4000)}`,
    `\nWORKFLOW ID: ${input.workflowId}`,
    input.chatId ? `CHAT ID: ${input.chatId}` : "RUN MODE: headless / workflow",
  ].join("\n");

  const body = {
    model,
    max_tokens: 1024,
    system: CLASSIFIER_SYSTEM_PROMPT,
    tools: [
      {
        name: "propose_memories",
        description:
          "Emit zero or more durable memory drafts derived from this turn.",
        input_schema: {
          type: "object",
          properties: {
            drafts: {
              type: "array",
              maxItems: 3,
              items: {
                type: "object",
                properties: {
                  text: { type: "string", maxLength: 600 },
                  kind: { type: "string", enum: [...MEMORY_KINDS] },
                  scope: { type: "string", enum: ["global", "chat"] },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  reasoning: { type: "string", maxLength: 400 },
                },
                required: ["text", "kind", "scope", "confidence"],
              },
            },
          },
          required: ["drafts"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "propose_memories" },
    messages: [{ role: "user", content: userBlock }],
  };

  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return [];
  }
  const json = (await res.json()) as {
    content?: Array<Record<string, unknown>>;
  };
  const block = (json.content ?? []).find(
    (c) => c.type === "tool_use" && c.name === "propose_memories"
  );
  if (!block) return [];
  const inputObj = (block.input ?? {}) as { drafts?: MemoryDraft[] };
  const drafts = Array.isArray(inputObj.drafts) ? inputObj.drafts : [];
  return drafts
    .filter((d): d is MemoryDraft => isValidDraft(d))
    .filter((d) => d.confidence >= MIN_DRAFT_CONFIDENCE)
    .slice(0, 3);
}

/**
 * Route classifier drafts to either `memories` (auto-save) or
 * `pending_memories` (operator review). Pure DB work; the smoke test calls
 * this directly without invoking the classifier.
 */
export function dispatchMemoryDrafts(
  drafts: MemoryDraft[],
  ctx: ClassifierContext,
  modeOverride?: "off" | "propose" | "on"
): DispatchResult {
  const mode = modeOverride ?? env.autoMemoryMode();
  const result: DispatchResult = { saved: [], pending: [], skipped: [] };
  if (mode === "off" || drafts.length === 0) return result;

  for (const draft of drafts) {
    if (!isValidDraft(draft)) {
      result.skipped.push({ draft, reason: "invalid draft" });
      continue;
    }
    const normalizedScope = normalizeNewMemoryScope(draft.scope, {
      chatId: ctx.chatId ?? null,
    });
    const scopeId = resolveScopeId(normalizedScope, draft, ctx);
    const conflicts = findConflictingMemories({
      text: draft.text,
      kind: draft.kind,
      scope: normalizedScope,
      scopeId,
    });

    const conflictSummaries: PendingMemoryConflict[] = conflicts.map((c) => ({
      memoryId: c.memory.id,
      text: c.memory.text,
      similarity: round2(c.similarity),
    }));

    const eligibleAutoSave =
      mode === "on" &&
      draft.confidence >= HIGH_CONFIDENCE_THRESHOLD &&
      conflictSummaries.length === 0;

    if (eligibleAutoSave) {
      const memory = rememberMemory({
        text: draft.text,
        kind: draft.kind,
        scope: normalizedScope,
        scopeId,
        confidence: draft.confidence,
        workflowId: ctx.workflowId,
        chatId: ctx.chatId ?? undefined,
        runId: ctx.runId,
        metadata: { origin: "auto_memory_high_confidence" },
      });
      result.saved.push(memory);
      continue;
    }

    const pending = createPendingMemory({
      chatId: ctx.chatId ?? null,
      runId: ctx.runId,
      workflowId: ctx.workflowId,
      draftText: draft.text,
      draftKind: draft.kind,
      draftScope: normalizedScope,
      draftScopeId: scopeId,
      confidence: draft.confidence,
      reasoning: draft.reasoning,
      conflicts: conflictSummaries,
    });
    result.pending.push(pending);
  }

  return result;
}

/**
 * End-to-end entry point used by the runner's Stop hook. Best-effort: any
 * failure here logs and returns silently — the user-facing turn has already
 * shipped, so a classifier hiccup must never propagate.
 */
export async function runAutoMemoryPipeline(
  input: ClassifierInput
): Promise<DispatchResult | null> {
  const mode = env.autoMemoryMode();
  if (mode === "off") return null;
  if (!input.userMessage.trim() || !input.agentAnswer.trim()) return null;

  try {
    const drafts = await classifyTurnForMemory(input);
    return dispatchMemoryDrafts(drafts, input, mode);
  } catch (err) {
    console.error("[auto-memory] pipeline failed:", err);
    return null;
  }
}

function isValidDraft(draft: unknown): draft is MemoryDraft {
  if (!draft || typeof draft !== "object") return false;
  const d = draft as Record<string, unknown>;
  if (typeof d.text !== "string" || d.text.trim().length < 4) return false;
  if (typeof d.kind !== "string" || !MEMORY_KINDS.includes(d.kind as MemoryKind)) {
    return false;
  }
  if (
    typeof d.scope !== "string" ||
    (d.scope !== "global" && d.scope !== "chat" && d.scope !== "workflow")
  ) {
    return false;
  }
  if (typeof d.confidence !== "number" || d.confidence < 0 || d.confidence > 1) {
    return false;
  }
  return true;
}

function resolveScopeId(
  scope: "global" | "chat",
  draft: MemoryDraft,
  ctx: ClassifierContext
): string | null {
  if (draft.scopeId) return draft.scopeId;
  if (scope === "chat") return ctx.chatId ?? null;
  return null;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
