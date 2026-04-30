import { NextRequest } from "next/server";
import { getChat, deleteChat } from "@/lib/db/chats";
import { getChatEvents, listRuns } from "@/lib/db/runs";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await ctx.params;
  const chat = getChat(chatId);
  if (!chat) return Response.json({ error: "not found" }, { status: 404 });
  const runs = listRuns({ chatId, limit: 200 });
  const events = getChatEvents(chatId);
  return Response.json({ chat, runs, events });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await ctx.params;
  if (!getChat(chatId)) return Response.json({ error: "not found" }, { status: 404 });
  deleteChat(chatId);
  return Response.json({ ok: true });
}
