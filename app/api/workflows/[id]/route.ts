import { NextRequest } from "next/server";
import { getWorkflow, updateWorkflow, deleteWorkflow } from "@/lib/db/workflows";
import { Workflow } from "@/lib/workflow/schema";
import { scheduleWorkflow, unscheduleWorkflow } from "@/lib/scheduler/cron";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const wf = getWorkflow(id);
  if (!wf) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ workflow: wf });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const existing = getWorkflow(id);
  if (!existing) return Response.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const candidate = {
    ...existing,
    ...body,
    id, // never let body override id
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const parsed = Workflow.safeParse(candidate);
  if (!parsed.success) {
    return Response.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 }
    );
  }
  updateWorkflow(parsed.data);
  scheduleWorkflow(parsed.data); // re-register cron (no-op if no cron)
  return Response.json({ ok: true, workflow: parsed.data });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  unscheduleWorkflow(id);
  deleteWorkflow(id);
  return Response.json({ ok: true });
}
