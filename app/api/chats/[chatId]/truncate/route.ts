import { NextRequest } from "next/server";
import { getChat, clearChatSessionId } from "@/lib/db/chats";
import { listRuns, truncateChatFromEventIndex } from "@/lib/db/runs";
import { getRun as getRunCtx } from "@/lib/runtime/run-registry";

export const runtime = "nodejs";

/**
 * Drop the run that owns chat-event #eventIndex and every later run. Powers
 * two affordances on the user message:
 *   - "retry from here"  → just truncate, keep the SDK session for resume.
 *   - "edit this message" → truncate + clearSession=true so the next turn
 *     starts a fresh ad-hoc analyst that only sees prior user messages
 *     (no replay of assistant responses or tool calls).
 *
 * If a run for this chat is still running, signal abort to it BEFORE we clear
 * session_id — otherwise its onSessionId callback can race-write the old
 * session id back after we've cleared it.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await ctx.params;
  if (!getChat(chatId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json()) as {
    eventIndex?: unknown;
    clearSession?: unknown;
  };
  if (typeof body.eventIndex !== "number" || !Number.isFinite(body.eventIndex)) {
    return Response.json({ error: "eventIndex required" }, { status: 400 });
  }
  const clearSession = body.clearSession === true;

  if (clearSession) {
    for (const run of listRuns({ chatId, limit: 50 })) {
      if (run.status !== "running") continue;
      getRunCtx(run.id)?.abort("Replaced by edited message.");
    }
  }

  const deleted = truncateChatFromEventIndex(chatId, body.eventIndex);

  if (clearSession) {
    clearChatSessionId(chatId);
  }

  return Response.json({ ok: true, deletedRuns: deleted });
}
