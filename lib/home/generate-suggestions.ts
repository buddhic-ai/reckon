import { query } from "@anthropic-ai/claude-agent-sdk";
import { env } from "@/lib/env";
import { resolveClaudeBinaryPath } from "@/lib/agent/claude-binary";
import { buildSaveChipsServer } from "@/lib/agent/tools/saveChips";
import { CHIP_ICONS } from "./types";

const SYSTEM_PROMPT = `You produce exactly four home-screen suggestion chips for an analyst-style chat
app. The user clicks one of these chips and the text becomes their first
question. Your only output is a single call to mcp__home_chips__save_chips
with four chips.

Steps:
1. Read lib/agent/knowledge/INDEX.md for orientation.
2. Read lib/agent/knowledge/insights.json for database_overview and
   query_templates. Read lib/agent/knowledge/schema.json only if you need
   more table detail.
3. Pick four chips that together feel like a useful starter set for someone
   exploring this specific database for the first time. Aim for variety:
   one time-trend question, one breakdown / segmentation question, one
   "top N" / leaderboard question, and one "inspect a single record" or
   "explore a hub table" question.

Hard rules for each chip:
- "icon" must be one of: ${CHIP_ICONS.join(", ")}.
- "label" is 2-3 words, Title Case, suitable for a card heading.
- "prompt" is one plain-English sentence the user could plausibly send
  as their first message. Use the actual subject domain of this database
  (orders, leads, tickets, devices, etc.) but DO NOT name specific table
  names, column names, IDs, or values — the agent can rediscover those.
  No GraphQL, no SQL, no schema jargon.

Examples of good prompts:
  - "How are leads trending week over week this quarter?"
  - "Break down support tickets by category — where are we spending time?"
  - "Show me the top 10 customers by revenue this year."
  - "Walk me through a recent high-value order."

Examples of bad prompts (do not produce):
  - "Show me order 43659 with all its line items." (specific ID)
  - "SELECT count(*) FROM activities_add_to_coinorder." (SQL)
  - "Query the activities_add_to_coinorder table." (table name leak)

Call mcp__home_chips__save_chips exactly once with four chips. Do not
write any other prose. Do not call any other tool than Read and
mcp__home_chips__save_chips.`;

export interface GenerateResult {
  ok: boolean;
  errorMessage?: string;
  totalCostUsd?: number;
  totalTokens?: number;
}

/**
 * Run the one-shot chip-generator agent. Persists chips via the
 * mcp__home_chips__save_chips tool keyed to `fingerprint`. Caller is
 * responsible for deciding whether to run this (i.e. fingerprint missing
 * from DB).
 */
export async function generateSuggestions(fingerprint: string): Promise<GenerateResult> {
  const abortController = new AbortController();
  const costCap = env.costCapUsd();

  let toolCalled = false;
  let totalTokens: number | undefined;
  let totalCostUsd: number | undefined;
  let errorMessage: string | undefined;

  try {
    const claudeBinPath = resolveClaudeBinaryPath();
    for await (const message of query({
      prompt: oneShotPrompt(),
      options: {
        systemPrompt: SYSTEM_PROMPT,
        model: env.anthropicModel(),
        maxTurns: 6,
        allowedTools: ["Read", "mcp__home_chips__save_chips"],
        disallowedTools: [
          "Bash",
          "Write",
          "Edit",
          "Glob",
          "Grep",
          "WebFetch",
          "WebSearch",
          "AskUserQuestion",
          "Agent",
        ],
        mcpServers: { home_chips: buildSaveChipsServer(fingerprint) },
        abortController,
        ...(claudeBinPath ? { pathToClaudeCodeExecutable: claudeBinPath } : {}),
      },
    })) {
      const m = message as Record<string, unknown>;
      if (m.type === "user") {
        const content = (m.message as { content?: unknown[] } | undefined)?.content;
        if (Array.isArray(content)) {
          for (const block of content as Array<Record<string, unknown>>) {
            if (block.type !== "tool_result") continue;
            const text = extractText(block.content);
            try {
              const parsed = JSON.parse(text);
              if (parsed && typeof parsed === "object" && parsed.ok === true) toolCalled = true;
            } catch {}
          }
        }
      }
      if (m.type === "result") {
        if (typeof m.total_cost_usd === "number") totalCostUsd = m.total_cost_usd;
        if (m.usage && typeof m.usage === "object") {
          const u = m.usage as Record<string, unknown>;
          totalTokens =
            ((u.input_tokens as number) ?? 0) +
            ((u.output_tokens as number) ?? 0) +
            ((u.cache_creation_input_tokens as number) ?? 0) +
            ((u.cache_read_input_tokens as number) ?? 0);
        }
        if (m.subtype !== "success") {
          errorMessage = (m.result as string) ?? "agent error";
        }
        break;
      }
      if (typeof totalCostUsd === "number" && totalCostUsd > costCap) {
        errorMessage = `cost cap reached ($${costCap.toFixed(2)})`;
        abortController.abort();
        break;
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (errorMessage) return { ok: false, errorMessage, totalCostUsd, totalTokens };
  if (!toolCalled) {
    return { ok: false, errorMessage: "agent did not call save_chips", totalCostUsd, totalTokens };
  }
  return { ok: true, totalCostUsd, totalTokens };
}

async function* oneShotPrompt() {
  yield {
    type: "user" as const,
    parent_tool_use_id: null,
    message: {
      role: "user" as const,
      content:
        "Produce four home-screen suggestion chips for this database. Follow the system prompt exactly: read the knowledge pack, then call save_chips once.",
    },
  };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const cb = c as Record<string, unknown>;
        return cb.type === "text" && typeof cb.text === "string" ? cb.text : "";
      })
      .join("");
  }
  return "";
}
