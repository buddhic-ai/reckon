import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { RunEvent } from "@/lib/runtime/event-types";
import type { A2UIMessage } from "@/lib/a2ui/types";

/**
 * Build a per-run MCP server exposing `mcp__ui__present`. The agent calls it
 * with one or more A2UI v0.9 messages; the server forwards them to the run's
 * SSE stream as a `surface` event so the chat UI can render them as cards.
 *
 * A factory closure is used (rather than a module-level singleton) so each
 * runWorkflow invocation gets its own `emit` binding.
 */
export function buildPresentServer(emit: (event: RunEvent) => void) {
  const presentTool = tool(
    "present",
    [
      "Present structured analytics output to the operator using the A2UI",
      "v0.9 protocol. Pass an array of messages — typically one createSurface,",
      "optionally one updateDataModel, and one updateComponents. Components",
      "must come from the analytics catalog: Section, KPI, Table, Chart,",
      "Callout. Prefer this over markdown when you have numeric findings,",
      "tabular data, or a chartable trend. The operator sees the rendered",
      "cards inline in the chat.",
    ].join(" "),
    {
      messages: z
        .array(
          z
            .object({ version: z.literal("v0.9") })
            .passthrough()
        )
        .min(1),
    },
    async (args) => {
      const valid = (args.messages as unknown[]).filter(isValidA2UIMessage);
      emit({ type: "surface", messages: valid });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: true, accepted: valid.length }),
          },
        ],
      };
    }
  );

  return createSdkMcpServer({
    name: "ui",
    version: "1.0.0",
    tools: [presentTool],
  });
}

function isValidA2UIMessage(m: unknown): m is A2UIMessage {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  if (o.version !== "v0.9") return false;
  return (
    "createSurface" in o ||
    "updateComponents" in o ||
    "updateDataModel" in o ||
    "deleteSurface" in o
  );
}
