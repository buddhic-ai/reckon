import { NextRequest } from "next/server";
import { ulid } from "ulid";
import { listWorkflows, insertWorkflow } from "@/lib/db/workflows";
import { getLastWorkflowRunStatuses } from "@/lib/db/runs";
import { Workflow } from "@/lib/workflow/schema";
import { scheduleWorkflow } from "@/lib/scheduler/cron";

export const runtime = "nodejs";

export async function GET() {
  const workflows = listWorkflows();
  const lastStatuses = getLastWorkflowRunStatuses();
  return Response.json({
    workflows: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      hasCron: !!w.triggers?.cron,
      cron: w.triggers?.cron,
      timezone: w.triggers?.timezone,
      lastRunStatus: lastStatuses.get(w.id) ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  const candidate = {
    id: typeof body.id === "string" && body.id.length > 0 ? body.id : ulid(),
    createdAt: now,
    updatedAt: now,
    ...body,
  };
  const parsed = Workflow.safeParse(candidate);
  if (!parsed.success) {
    return Response.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 }
    );
  }
  insertWorkflow(parsed.data);
  scheduleWorkflow(parsed.data);
  return Response.json({ ok: true, workflow: parsed.data });
}
