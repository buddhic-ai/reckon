import { z } from "zod";

const ToolName = z
  .string()
  .regex(/^[a-zA-Z0-9_*-]+(__[a-zA-Z0-9_*-]+)*$/, "invalid tool name");

export const WorkflowStep = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const WorkflowTriggers = z.object({
  cron: z.string().optional(),
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
});
export type WorkflowTriggers = z.infer<typeof WorkflowTriggers>;

export const SchemaHints = z.object({
  tables: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
export type SchemaHints = z.infer<typeof SchemaHints>;

export const Workflow = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string(),
  systemPromptOverlay: z.string(),
  allowedTools: z.array(ToolName).optional(),
  disallowedTools: z.array(ToolName).optional(),
  steps: z.array(WorkflowStep),
  schemaHints: SchemaHints.optional(),
  triggers: WorkflowTriggers.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Workflow = z.infer<typeof Workflow>;

export const WorkflowDraft = Workflow.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type WorkflowDraft = z.infer<typeof WorkflowDraft>;
