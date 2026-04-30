import { NextRequest } from "next/server";
import { ulid } from "ulid";
import { getWorkflow, getWorkflowByName } from "@/lib/db/workflows";
import {
  createRun,
  finishRun,
  appendRunEvent,
} from "@/lib/db/runs";
import {
  createChat,
  getChat,
  setChatSessionId,
  setChatTitleIfBlank,
  touchChat,
} from "@/lib/db/chats";
import { AsyncMessageQueue } from "@/lib/runtime/async-queue";
import {
  registerRun,
  type SDKUserMessageLike,
} from "@/lib/runtime/run-registry";
import { formatSseFrame, SSE_HEADERS } from "@/lib/runtime/sse";
import type { RunEvent } from "@/lib/runtime/event-types";
import { runWorkflow, type AskUserFn } from "@/lib/agent/runner";
import { AD_HOC_ANALYST_NAME } from "@/lib/agent/seed-adhoc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a new SDK run. Two shapes:
 *   - { workflowId, initialUserMessage? } — workflow run (cron / manual / detail page).
 *   - { chatId?, initialUserMessage }     — chat turn. If chatId is omitted a new
 *     chat is created on the fly. The Ad-hoc Analyst workflow backs the chat.
 *
 * For chat turns: the SDK session_id is stored on the chat row on the first
 * turn and passed back as `resume` on subsequent turns, so prompt-cache hits
 * carry across the chat and full tool-call fidelity is preserved.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const explicitWorkflowId: string | undefined = body.workflowId;
  const initialUserMessage: string | undefined = body.initialUserMessage;
  let chatId: string | undefined = body.chatId;

  // Mode resolution.
  // - workflowId without chatId → workflow run.
  // - chatId or no workflowId  → chat turn against the ad-hoc analyst.
  const isChat = !explicitWorkflowId || chatId !== undefined;

  let workflowId = explicitWorkflowId;
  if (isChat) {
    const adhoc = getWorkflowByName(AD_HOC_ANALYST_NAME);
    if (!adhoc) {
      return Response.json(
        { error: "ad-hoc analyst not seeded; reboot the server" },
        { status: 500 }
      );
    }
    workflowId = adhoc.id;
    if (!chatId) {
      chatId = ulid();
      createChat(chatId);
    } else if (!getChat(chatId)) {
      // Caller passed a chatId but no row exists — create it idempotently.
      createChat(chatId);
    }
  }

  if (!workflowId) {
    return Response.json({ error: "missing workflowId" }, { status: 400 });
  }
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    return Response.json({ error: "workflow not found" }, { status: 404 });
  }

  const runId = ulid();
  createRun({
    id: runId,
    workflowId,
    chatId: chatId ?? null,
    kind: "runner",
    trigger: "manual",
  });

  // Frozen chatId for use inside the stream closure (let widens back to
  // string|undefined across closure boundaries).
  const boundChatId: string | undefined = chatId;

  // For chat turns, resume the SDK session so prompt-cache hits carry across
  // turns. The session_id is captured on the first turn (see onSessionId
  // below) and persisted on the chat row.
  const resumeSessionId = boundChatId
    ? getChat(boundChatId)?.session_id ?? undefined
    : undefined;

  // Set title from the first user message if blank.
  if (chatId && initialUserMessage && initialUserMessage.trim()) {
    setChatTitleIfBlank(chatId, initialUserMessage);
  }

  const messageQueue = new AsyncMessageQueue<SDKUserMessageLike>();
  const seedMessage =
    initialUserMessage && initialUserMessage.trim().length > 0
      ? initialUserMessage
      : `Run the workflow "${workflow.name}".`;
  messageQueue.push({
    type: "user",
    message: { role: "user", content: seedMessage },
    parent_tool_use_id: null,
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (frame: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(frame);
        } catch {
          closed = true;
        }
      };

      const emit = (event: RunEvent) => {
        appendRunEvent(runId, event);
        if (chatId) touchChat(chatId);
        safeEnqueue(formatSseFrame(event));
      };

      const abortController = new AbortController();
      const ctx = registerRun(runId, emit, messageQueue, abortController);

      const askUser: AskUserFn = async (q) => {
        const questionId = ulid();
        emit({
          type: "question",
          questionId,
          question: q.question,
          header: q.header,
          options: q.options,
          multiSelect: q.multiSelect,
        });
        return ctx.waitForAnswer(questionId);
      };

      // Hello frame carries runId + chatId so the client knows where it landed.
      safeEnqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "_hello", runId, chatId: chatId ?? null })}\n\n`
        )
      );

      // Persist the seed user message as an event so chat replays show it.
      if (initialUserMessage && initialUserMessage.trim().length > 0) {
        emit({ type: "user_message", text: initialUserMessage });
      }

      void runWorkflow({
        workflow,
        userMessages: messageQueue,
        emit,
        askUser,
        abortController,
        mode: "live",
        resumeSessionId,
        onSessionId: boundChatId
          ? (sid) => {
              try {
                setChatSessionId(boundChatId, sid);
              } catch {
                // best-effort; resume just won't work next turn
              }
            }
          : undefined,
      })
        .then((result) => {
          finishRun({
            id: runId,
            status: result.status,
            errorMessage: result.errorMessage ?? null,
            totalTokens: result.totalTokens ?? null,
            totalCostUsd: result.totalCostUsd ?? null,
            resultSummary: result.finalText.slice(0, 4000),
          });
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          finishRun({ id: runId, status: "error", errorMessage: msg });
        })
        .finally(() => {
          ctx.close("run complete");
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });

      req.signal.addEventListener("abort", () => {
        abortController.abort();
      });
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
