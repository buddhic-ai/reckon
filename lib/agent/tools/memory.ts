import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  MEMORY_KINDS,
  MEMORY_SCOPES,
  archiveMemory,
  rememberMemory,
  searchLongTermMemory,
  type MemoryContext,
} from "@/lib/db/memories";

export interface MemoryToolContext extends MemoryContext {
  workflowId: string;
}

/**
 * Per-run memory tools. The search tool reads both curated memories and the
 * persisted run archive, so old user statements remain addressable even when
 * they were never explicitly promoted into a saved memory.
 */
export function buildMemoryServer(ctx: MemoryToolContext) {
  const searchTool = tool(
    "search",
    [
      "Search Reckon's long-term memory. Returns saved memories plus matching",
      "historical chat/run archive entries. Use this before answering when a",
      "question may depend on preferences, prior decisions, metric definitions,",
      "business rules, workflows, named entities, or older context.",
    ].join(" "),
    {
      query: z.string().max(800),
      limit: z.number().int().min(1).max(20).optional(),
      includeArchives: z.boolean().optional(),
    },
    async (args) => {
      const results = searchLongTermMemory({
        query: args.query,
        limit: args.limit,
        includeArchives: args.includeArchives,
        workflowId: ctx.workflowId,
        chatId: ctx.chatId,
        runId: ctx.runId,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: true, ...results }),
          },
        ],
      };
    }
  );

  const rememberTool = tool(
    "remember",
    [
      "Save a durable memory for future Reckon sessions. Use when the operator",
      "explicitly asks you to remember something, corrects a recurring assumption,",
      "defines a metric/business rule, or gives a stable preference that should",
      "affect future answers.",
    ].join(" "),
    {
      text: z.string().min(5).max(2000),
      kind: z.enum(MEMORY_KINDS),
      scope: z.enum(MEMORY_SCOPES).optional(),
      scopeId: z.string().min(1).max(200).optional(),
      pinned: z.boolean().optional(),
      confidence: z.number().min(0).max(1).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
    async (args) => {
      const memory = rememberMemory({
        text: args.text,
        kind: args.kind,
        scope: args.scope,
        scopeId: args.scopeId,
        pinned: args.pinned,
        confidence: args.confidence,
        metadata: args.metadata,
        workflowId: ctx.workflowId,
        chatId: ctx.chatId,
        runId: ctx.runId,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: true, memory }),
          },
        ],
      };
    }
  );

  const forgetTool = tool(
    "forget",
    "Archive a saved memory by id. Use only when the operator asks you to forget, remove, replace, or correct that memory.",
    {
      id: z.string().min(1),
      reason: z.string().max(500).optional(),
    },
    async (args) => {
      const forgotten = archiveMemory(args.id, {
        reason: args.reason,
        workflowId: ctx.workflowId,
        chatId: ctx.chatId,
        runId: ctx.runId,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: forgotten, id: args.id }),
          },
        ],
      };
    }
  );

  return createSdkMcpServer({
    name: "memory",
    version: "1.0.0",
    tools: [searchTool, rememberTool, forgetTool],
  });
}
