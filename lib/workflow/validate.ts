import { Workflow, type Workflow as WorkflowType } from "./schema";

export function parseWorkflow(input: unknown): WorkflowType {
  return Workflow.parse(input);
}

export function safeParseWorkflow(input: unknown):
  | { ok: true; workflow: WorkflowType }
  | { ok: false; error: string } {
  const r = Workflow.safeParse(input);
  if (r.success) return { ok: true, workflow: r.data };
  return { ok: false, error: r.error.message };
}
