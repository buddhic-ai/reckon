/**
 * Build the "prior conversation" block for resuming a chat. The SDK's prompt
 * iterable only accepts user messages, so assistant turns can't be primed
 * directly — we splice the last N turns into the system prompt instead.
 *
 * Tool calls, surfaces, status, and errors are dropped — only the verbal
 * back-and-forth (user_message + result) is replayed. That's enough context
 * for the agent to maintain conversational coherence without bloating tokens.
 */
import type { RunEvent } from "@/lib/runtime/event-types";

const DEFAULT_MAX_TURNS = 30;

export function buildPriorHistoryBlock(
  events: RunEvent[],
  maxTurns: number = DEFAULT_MAX_TURNS
): string {
  const turns: string[] = [];
  for (const ev of events) {
    if (ev.type === "user_message") {
      turns.push(`User: ${ev.text}`);
    } else if (ev.type === "result" && ev.text && ev.text.trim()) {
      turns.push(`Assistant: ${ev.text}`);
    }
  }
  if (turns.length === 0) return "";
  // Keep the last N turns. Each turn is one user OR one assistant entry,
  // so 30 turns ≈ 15 user/assistant exchanges.
  const tail = turns.slice(-maxTurns);
  return tail.join("\n\n");
}
