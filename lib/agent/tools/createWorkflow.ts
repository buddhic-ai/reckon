import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ulid } from "ulid";
import { Workflow } from "@/lib/workflow/schema";
import {
  insertWorkflow,
  updateWorkflow,
  getWorkflowByName,
} from "@/lib/db/workflows";

/**
 * Save (create or update) a workflow.
 *
 * Upsert by name: if a workflow with the same name already exists, the row is
 * updated in place — the existing id and createdAt are preserved. Otherwise a
 * fresh ulid + createdAt is minted. The agent gets back `{action}` so it can
 * tell the user "Created" vs "Updated" in the confirmation.
 *
 * The `canUseTool` gate intercepts every invocation of this tool with a
 * synthetic AskUserQuestion summarising the save — the user has to approve
 * before the call lands here. See lib/agent/runner.ts: makeGate().
 *
 * Per-run idempotency (max one save per SDK invocation) is also enforced in
 * the gate, as a belt-and-braces safety net.
 */
const createWorkflowTool = tool(
  "create_workflow",
  "Save (create or update) a workflow. Upserts by name — if a workflow with the same name exists, it is updated in place. The user is shown a confirmation summary and must approve before this fires.",
  {
    name: z.string().min(1).max(120),
    description: z.string(),
    systemPromptOverlay: z.string(),
    steps: z.array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
      })
    ),
    schemaHints: z
      .object({
        tables: z.array(z.string()).optional(),
        notes: z.string().optional(),
      })
      .optional(),
    triggers: z
      .object({
        cron: z.string().optional(),
        timezone: z.string().optional(),
        enabled: z.boolean().optional(),
      })
      .optional(),
  },
  async (args) => {
    const now = new Date().toISOString();
    const existing = getWorkflowByName(args.name);
    const candidate = {
      id: existing?.id ?? ulid(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...args,
    };
    const parsed = Workflow.safeParse(candidate);
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `validation_error: ${JSON.stringify(parsed.error.format())}`,
          },
        ],
      };
    }
    const action: "created" | "updated" = existing ? "updated" : "created";
    if (existing) {
      updateWorkflow(parsed.data);
    } else {
      insertWorkflow(parsed.data);
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            ok: true,
            action,
            workflowId: parsed.data.id,
            name: parsed.data.name,
          }),
        },
      ],
    };
  }
);

export const workflowBuilderServer = createSdkMcpServer({
  name: "workflow_builder",
  version: "1.0.0",
  tools: [createWorkflowTool],
});
