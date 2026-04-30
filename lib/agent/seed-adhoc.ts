/**
 * Seed the built-in "Ad-hoc Analyst" workflow on boot. This is the workflow
 * that backs the chat surface at `/` — a generic analyst with access to
 * graphjin (via Bash), the present() catalog, and the workflow_builder save
 * tool (so the user can say "save this as a workflow" mid-chat).
 *
 * Looked up by name (`AD_HOC_ANALYST_NAME`) so it survives across reboots
 * without leaking ulids into env vars.
 */
import { ulid } from "ulid";
import { getWorkflowByName, insertWorkflow } from "@/lib/db/workflows";
import type { Workflow } from "@/lib/workflow/schema";

export const AD_HOC_ANALYST_NAME = "Ad-hoc Analyst";

const SYSTEM_PROMPT_OVERLAY = `You are the user's analytics co-pilot. The user can ask anything
about the AdventureWorks database, attach files for inspection, or ask
you to save a recurring task as a saved workflow.

Behaviors:
- Answer factual data questions by querying GraphJin via Bash. Read
  lib/agent/knowledge/INDEX.md first if you don't already know the
  schema.
- Use mcp__ui__present for numbers / tables / charts. Always follow up
  with a 1-3 sentence prose synthesis explaining what stands out.
- If the user asks you to "save this as a workflow" / "schedule this" /
  "make this recurring", call mcp__workflow_builder__create_workflow
  exactly once. The user will see a confirmation summary and approve
  the save. If they cancel, ask what to change.
- File attachments arrive as paths in the chat. Read them via the Read
  tool when relevant.
- Be conversational. The user can ask follow-ups; prior turns are in
  your context (last 30 messages).`;

export function ensureAdHocAnalystWorkflow(): Workflow {
  const existing = getWorkflowByName(AD_HOC_ANALYST_NAME);
  if (existing) return existing;

  const now = new Date().toISOString();
  const wf: Workflow = {
    id: ulid(),
    name: AD_HOC_ANALYST_NAME,
    description:
      "Built-in chat surface. Answers ad-hoc analytics questions and can save itself as a saved workflow on request.",
    systemPromptOverlay: SYSTEM_PROMPT_OVERLAY,
    // Inherit DEFAULT_ALLOWED_TOOLS plus workflow_builder. Explicit list keeps
    // this self-documenting.
    allowedTools: [
      "Bash",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch",
      "AskUserQuestion",
      "mcp__ui__*",
      "mcp__workflow_builder__*",
    ],
    steps: [
      { id: "s1", description: "Read the user's question and any attachments." },
      {
        id: "s2",
        description:
          "Answer with present() cards for data, prose for synthesis. Keep it concise.",
      },
      {
        id: "s3",
        description:
          "If asked to save as a workflow, call create_workflow once and let the user confirm.",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  insertWorkflow(wf);
  return wf;
}
