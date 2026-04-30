import { NextRequest } from "next/server";
import { getRun } from "@/lib/runtime/run-registry";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { runId, questionId, answer } = body as {
    runId?: string;
    questionId?: string;
    answer?: string;
  };
  if (!runId || !questionId || typeof answer !== "string") {
    return Response.json(
      { error: "missing runId, questionId, or answer" },
      { status: 400 }
    );
  }
  const ctx = getRun(runId);
  if (!ctx) {
    return Response.json({ error: "run not found" }, { status: 404 });
  }
  ctx.resolveAnswer(questionId, answer);
  return Response.json({ ok: true });
}
