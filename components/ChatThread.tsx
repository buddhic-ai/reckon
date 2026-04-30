"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import type { RunEvent } from "@/lib/runtime/event-types";
import { MessageItem } from "./MessageItem";
import { ToolCallRow } from "./ToolCallRow";
import { QuestionBubble, type PendingQuestion } from "./QuestionBubble";
import { Surface } from "./Surface";

interface Props {
  events: RunEvent[];
  /** When true, show tool_call/tool_result rows inline. */
  showTools?: boolean;
  pendingAnswers?: Record<string, string | undefined>;
  onAnswer?: (questionId: string, answer: string) => void;
  /** When provided, user messages get hover copy/retry actions. The handler
   *  is responsible for truncating server state and re-running. */
  onRetryUserMessage?: (eventIndex: number, text: string) => void;
}

type ToolPair = {
  call: Extract<RunEvent, { type: "tool_call" }>;
  result?: Extract<RunEvent, { type: "tool_result" }>;
};

/**
 * Render rules collapse the raw event stream into something readable:
 *   - Pair tool_call + tool_result by toolUseId; orphans are still shown.
 *   - Group consecutive tool pairs into one "Tool activity" disclosure
 *     (collapsed by default if it has more than 2 rows).
 *   - Status events render as a single thin italic line.
 *   - Errors render as red banners.
 *   - Questions, thoughts, results render through their own components.
 */
export function ChatThread({
  events,
  showTools = true,
  pendingAnswers,
  onAnswer,
  onRetryUserMessage,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, autoScroll]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(atBottom);
  }

  const grouped = useMemo(() => groupEvents(events), [events]);
  const suppressedThoughts = useMemo(() => findDuplicateThoughts(events), [events]);

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-4 pb-24"
    >
      {grouped.map((node, idx) => {
        if (node.kind === "tool_group") {
          if (!showTools) return null;
          return <ToolGroup key={`tg-${idx}`} pairs={node.pairs} />;
        }
        const event = node.event;
        if (event.type === "question") {
          const q: PendingQuestion = {
            questionId: event.questionId,
            question: event.question,
            header: event.header,
            options: event.options,
            multiSelect: event.multiSelect,
          };
          const answered = pendingAnswers?.[event.questionId];
          return (
            <QuestionBubble
              key={event.questionId}
              question={q}
              onAnswer={(qid, ans) => onAnswer?.(qid, ans)}
              answered={answered}
            />
          );
        }
        if (event.type === "done") return null;
        if (event.type === "surface") {
          return <Surface key={`s-${idx}`} messages={event.messages} />;
        }
        // Suppress the agent's `thought` if a `result` event carries the same
        // prose (the SDK frequently emits the same text in both).
        if (
          event.type === "thought" &&
          suppressedThoughts.has(event.text.trim())
        ) {
          return null;
        }
        return (
          <MessageItem
            key={`m-${idx}`}
            event={event}
            eventIndex={node.eventIndex}
            onRetry={onRetryUserMessage}
            showActions={!!onRetryUserMessage}
          />
        );
      })}
    </div>
  );
}

type GroupedNode =
  | { kind: "event"; event: RunEvent; eventIndex: number }
  | { kind: "tool_group"; pairs: ToolPair[] };

/** Set of trimmed thought texts that match a `result` event in the same
 * stream — those thoughts get suppressed so we don't render the same prose
 * twice (once as plain markdown, once as the highlighted result card). */
function findDuplicateThoughts(events: RunEvent[]): Set<string> {
  const out = new Set<string>();
  for (const ev of events) {
    if (ev.type === "result" && ev.text && ev.text.trim()) {
      out.add(ev.text.trim());
    }
  }
  return out;
}

function groupEvents(events: RunEvent[]): GroupedNode[] {
  // Pair tool_call with its tool_result by toolUseId. Non-tool events
  // (including surface, thought, status) break the visual tool group, but
  // we still pair across the break by remembering the open call's location.
  const out: GroupedNode[] = [];
  type CallLoc = { groupIdx: number; pairIdx: number };
  const callLoc = new Map<string, CallLoc>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === "tool_call") {
      const last = out[out.length - 1];
      const pair: ToolPair = { call: ev };
      if (last && last.kind === "tool_group") {
        last.pairs.push(pair);
        callLoc.set(ev.toolUseId, {
          groupIdx: out.length - 1,
          pairIdx: last.pairs.length - 1,
        });
      } else {
        out.push({ kind: "tool_group", pairs: [pair] });
        callLoc.set(ev.toolUseId, { groupIdx: out.length - 1, pairIdx: 0 });
      }
      continue;
    }
    if (ev.type === "tool_result") {
      const loc = callLoc.get(ev.toolUseId);
      if (loc) {
        const target = out[loc.groupIdx];
        if (target && target.kind === "tool_group") {
          target.pairs[loc.pairIdx].result = ev;
          callLoc.delete(ev.toolUseId);
          continue;
        }
      }
      // Orphan: no matching tool_call. Drop into the current/new tool group.
      const last = out[out.length - 1];
      const orphanPair: ToolPair = {
        call: {
          type: "tool_call",
          toolUseId: ev.toolUseId,
          tool: "(result)",
          summary: ev.summary,
        },
        result: ev,
      };
      if (last && last.kind === "tool_group") last.pairs.push(orphanPair);
      else out.push({ kind: "tool_group", pairs: [orphanPair] });
      continue;
    }
    // Other events break the visible group but keep the call→result map alive.
    out.push({ kind: "event", event: ev, eventIndex: i });
  }
  return out;
}

function ToolGroup({ pairs }: { pairs: ToolPair[] }) {
  // Init: auto-expand small groups (<=2 rows). useState ignores subsequent
  // arg changes, so a group that grows past 2 mid-stream stays in whatever
  // state the user has settled on.
  const [open, setOpen] = useState(() => pairs.length <= 2);
  const inflight = pairs.some((p) => !p.result);
  const failures = pairs.filter((p) => p.result && !p.result.ok).length;
  return (
    <div className="space-y-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-fg-3 hover:text-fg-1"
      >
        <Wrench className="h-3 w-3" />
        <span>{pairs.length} tool call{pairs.length === 1 ? "" : "s"}</span>
        {inflight ? <span className="text-accent">· running</span> : null}
        {failures > 0 ? <span className="text-bad">· {failures} failed</span> : null}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 pl-4">
          {pairs.map((p, i) => (
            <ToolCallRow key={`${p.call.toolUseId}-${i}`} call={p.call} result={p.result} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
