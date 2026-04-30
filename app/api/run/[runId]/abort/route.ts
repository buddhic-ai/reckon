import { NextRequest } from "next/server";
import { getRun as getRunCtx } from "@/lib/runtime/run-registry";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ runId: string }>;
}

/**
 * Stop a running SDK invocation. The user clicks Stop in the chat composer →
 * we look up the run in the in-memory registry and signal its AbortController.
 * The runner observes the abort and finishes with status="aborted".
 *
 * Idempotent: aborting an already-finished run is a no-op (returns ok: false).
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { runId } = await params;
  const ctx = getRunCtx(runId);
  if (!ctx) {
    return Response.json(
      { ok: false, reason: "run not found or already finished" },
      { status: 404 }
    );
  }
  const aborted = ctx.abort("Stopped by user.");
  return Response.json({ ok: aborted });
}
