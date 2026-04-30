import { NextRequest } from "next/server";
import { getRun } from "@/lib/db/runs";
import { replayRun } from "@/lib/runtime/replay";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ runId: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return Response.json({ error: "not found" }, { status: 404 });
  const events = replayRun(runId);
  return Response.json({ run, events });
}
