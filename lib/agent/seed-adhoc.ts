/**
 * Seed the built-in "Ad-hoc Analyst" workflow on boot. This is the workflow
 * that backs the chat surface at `/` — a generic analyst with access to
 * graphjin (via Bash), the present() catalog, and builder tools (so the user
 * can say "save this as a workflow" or "save this as a skill" mid-chat).
 *
 * Looked up by name (`AD_HOC_ANALYST_NAME`) so it survives across reboots
 * without leaking ulids into env vars.
 */
import { ulid } from "ulid";
import { getWorkflowByName, insertWorkflow, updateWorkflow } from "@/lib/db/workflows";
import type { Workflow } from "@/lib/workflow/schema";

export const AD_HOC_ANALYST_NAME = "Ad-hoc Analyst";

const SYSTEM_PROMPT_OVERLAY = `You are the user's analytics co-pilot. The user can ask anything
about the connected database, attach files for inspection, ask you to save a
recurring task as a saved workflow, or ask you to create an Agent Skill.

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
- If the user asks you to create or save a reusable skill, write it as an
  agentskills.io skill by calling mcp__skill_builder__create_skill exactly
  once. Use a lowercase hyphenated name, a description that says what the
  skill does and when to use it, and a concise SKILL.md body. Put detailed
  supporting material in references/, scripts/, or assets/ only when useful.
- File attachments arrive as paths in the chat. Read them via the Read
  tool when relevant.
- Use long-term memory. Search memory before answering if the question may
  depend on the user's preferences, prior decisions, definitions, corrections,
  or historical context. If you use memory, briefly call out what you used.
- If the user asks you to remember or forget something, use the memory tools.
- Be conversational. The user can ask follow-ups; prior turns are in
  your context (last 30 messages).`;

export function ensureAdHocAnalystWorkflow(): Workflow {
  const existing = getWorkflowByName(AD_HOC_ANALYST_NAME);
  if (existing) {
    const allowedTools = Array.from(
      new Set([
        ...(existing.allowedTools ?? []),
        "Skill",
        "mcp__memory__*",
        "mcp__skill_builder__*",
      ])
    );
    if (
      existing.systemPromptOverlay !== SYSTEM_PROMPT_OVERLAY ||
      !existing.allowedTools?.includes("Skill") ||
      !existing.allowedTools?.includes("mcp__memory__*") ||
      !existing.allowedTools?.includes("mcp__skill_builder__*")
    ) {
      const updated = {
        ...existing,
        systemPromptOverlay: SYSTEM_PROMPT_OVERLAY,
        allowedTools,
        updatedAt: new Date().toISOString(),
      };
      updateWorkflow(updated);
      return updated;
    }
    return existing;
  }

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
      "Skill",
      "mcp__ui__*",
      "mcp__memory__*",
      "mcp__workflow_builder__*",
      "mcp__skill_builder__*",
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
      {
        id: "s4",
        description:
          "If asked to save as a skill, call create_skill once and let the user confirm.",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  insertWorkflow(wf);
  return wf;
}
