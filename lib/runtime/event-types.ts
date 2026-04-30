/**
 * Events emitted by a running agent and consumed by the SSE stream + persisted
 * to run_events for replay. Narrowed from the RO project — no entityKey/
 * bucketReview/surfaceId, no OCR-specific events. The a2ui surface event
 * lands here once the engine + present tool exist (see lib/a2ui/).
 */
import type { A2UIMessage } from "@/lib/a2ui/types";

export type RunEvent =
  | { type: "status"; text: string }
  | { type: "user_message"; text: string }
  | { type: "thought"; text: string }
  | {
      type: "tool_call";
      toolUseId: string;
      tool: string;
      summary: string;
      /** Full JSON of the tool input. Populated from the SDK's tool_use block. */
      argsJson?: string;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      ok: boolean;
      summary: string;
      /** Full text of the tool result, capped at 64 KB. */
      text?: string;
    }
  | {
      type: "question";
      questionId: string;
      question: string;
      header?: string;
      options?: { label: string; description?: string }[];
      multiSelect?: boolean;
    }
  | { type: "result"; ok: boolean; text: string }
  | {
      type: "surface";
      /** A2UI v0.9 messages emitted by the agent's mcp__ui__present tool. */
      messages: A2UIMessage[];
    }
  | { type: "error"; stage: "agent" | "validation" | "server"; message: string }
  | { type: "done" };

export type RunEventType = RunEvent["type"];
