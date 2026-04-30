import { NextRequest } from "next/server";
import { getRun } from "@/lib/runtime/run-registry";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { runId, text } = body as { runId?: string; text?: string };
  if (!runId || typeof text !== "string") {
    return Response.json({ error: "missing runId or text" }, { status: 400 });
  }
  const ctx = getRun(runId);
  if (!ctx) {
    return Response.json({ error: "run not found" }, { status: 404 });
  }
  // Persist the user message + broadcast to clients so replays + live UI both
  // see the same thing. The run registry's emit writes to run_events too.
  ctx.emit({ type: "user_message", text });
  const ok = ctx.sendUserMessage(text);
  return Response.json({ ok });
}
