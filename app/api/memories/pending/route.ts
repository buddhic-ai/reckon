import { NextRequest } from "next/server";
import {
  listAllPending,
  listPendingForChat,
  listPendingForRun,
  listPendingForWorkflow,
} from "@/lib/db/pendingMemories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/memories/pending?chatId=...
 * GET /api/memories/pending?runId=...
 * GET /api/memories/pending?workflowId=...
 * GET /api/memories/pending          (all proposed)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId");
  const runId = url.searchParams.get("runId");
  const workflowId = url.searchParams.get("workflowId");

  let pending;
  if (chatId) pending = listPendingForChat(chatId);
  else if (runId) pending = listPendingForRun(runId);
  else if (workflowId) pending = listPendingForWorkflow(workflowId);
  else pending = listAllPending({ status: "proposed" });

  return Response.json({ pending });
}
