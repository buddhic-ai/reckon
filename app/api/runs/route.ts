import { NextRequest } from "next/server";
import { listRuns } from "@/lib/db/runs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const workflowId = url.searchParams.get("workflow") ?? undefined;
  const limitStr = url.searchParams.get("limit");
  const limit = limitStr ? Math.min(500, Math.max(1, Number(limitStr) || 100)) : 100;
  const runs = listRuns({ workflowId, limit });
  return Response.json({ runs });
}
