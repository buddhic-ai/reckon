import { NextRequest } from "next/server";
import { getRun, deleteRun } from "@/lib/db/runs";
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

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return Response.json({ error: "not found" }, { status: 404 });
  if (run.status === "running") {
    return Response.json({ error: "cannot delete a running run" }, { status: 409 });
  }
  deleteRun(runId);
  return Response.json({ ok: true });
}
