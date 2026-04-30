import { NextRequest } from "next/server";
import { getChat } from "@/lib/db/chats";
import { truncateChatFromEventIndex } from "@/lib/db/runs";

export const runtime = "nodejs";

/**
 * Drop the run that owns chat-event #eventIndex and every later run. Powers
 * the user-message "retry from here" affordance — replay should reflect the
 * new branch only.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await ctx.params;
  if (!getChat(chatId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json()) as { eventIndex?: unknown };
  if (typeof body.eventIndex !== "number" || !Number.isFinite(body.eventIndex)) {
    return Response.json({ error: "eventIndex required" }, { status: 400 });
  }
  const deleted = truncateChatFromEventIndex(chatId, body.eventIndex);
  return Response.json({ ok: true, deletedRuns: deleted });
}
