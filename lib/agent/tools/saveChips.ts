import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { saveSuggestions } from "@/lib/db/suggestions";
import type { Suggestion } from "@/lib/home/types";

/**
 * MCP tool used exclusively by the home-suggestions generator. Persists four
 * suggestion chips to the home_suggestions table under the fingerprint
 * computed at boot. Same shape pattern as create_workflow — the agent calls
 * this once at the end of its run.
 */
export function buildSaveChipsServer(fingerprint: string) {
  const saveChipsTool = tool(
    "save_chips",
    "Persist exactly four home-screen suggestion chips for the current database. Call this once after you've decided on the chips. The chips show as cards on the app home page.",
    {
      chips: z
        .array(
          z.object({
            icon: z.enum(["chart", "database", "file", "users", "trending", "clock"]),
            label: z.string().min(1).max(40),
            prompt: z.string().min(8).max(280),
          })
        )
        .length(4),
    },
    async (args) => {
      saveSuggestions(fingerprint, args.chips as Suggestion[]);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: true, count: args.chips.length, fingerprint }),
          },
        ],
      };
    }
  );

  return createSdkMcpServer({
    name: "home_chips",
    version: "1.0.0",
    tools: [saveChipsTool],
  });
}
