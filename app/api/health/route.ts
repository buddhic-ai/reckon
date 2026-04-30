import { knowledgeStatus } from "@/lib/agent/knowledge-loader";
import { getDb } from "@/lib/db/client";
import { activeRunCount } from "@/lib/runtime/run-registry";
import { activeJobIds } from "@/lib/scheduler/cron";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, unknown> = {};
  let ok = true;

  try {
    const k = await knowledgeStatus();
    checks.knowledge = k;
    if (k.missing.length > 0) ok = false;
  } catch (e) {
    ok = false;
    checks.knowledge = { error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const db = getDb();
    const count = (db.prepare("SELECT COUNT(*) as c FROM workflows").get() as { c: number }).c;
    checks.db = { ok: true, workflows: count };
  } catch (e) {
    ok = false;
    checks.db = { error: e instanceof Error ? e.message : String(e) };
  }

  checks.runs = { active: activeRunCount() };
  checks.scheduler = { jobs: activeJobIds() };
  checks.config = {
    graphjinBaseUrl: env.graphjinBaseUrl(),
    model: env.anthropicModel(),
    timezone: env.defaultTimezone(),
    costCapUsd: env.costCapUsd(),
  };

  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
