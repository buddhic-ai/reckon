import { ulid } from "ulid";
import { createChat, listChats } from "@/lib/db/chats";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ chats: listChats(50) });
}

export async function POST() {
  const id = ulid();
  const chat = createChat(id);
  return Response.json({ chat });
}
