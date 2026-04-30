"use client";

import { useEffect, useRef, useState } from "react";
import type { RunEvent } from "@/lib/runtime/event-types";

export interface AgentStreamState {
  events: RunEvent[];
  runId: string | null;
  done: boolean;
  error: string | null;
  answers: Record<string, string>;
}

interface Args {
  endpoint: "/api/run" | "/api/builder";
  body: Record<string, unknown>;
  /** Optional callback when the run finishes (done event arrived). */
  onDone?: () => void;
}

/**
 * Open an SSE stream against /api/run or /api/builder by POSTing the body and
 * reading the response as a stream. Tracks events, the runId from the _hello
 * frame, and a done flag.
 */
export function useAgentStream({ endpoint, body, onDone }: Args) {
  const [state, setState] = useState<AgentStreamState>({
    events: [],
    runId: null,
    done: false,
    error: null,
    answers: {},
  });
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          setState((s) => ({ ...s, error: `HTTP ${res.status}`, done: true }));
          onDone?.();
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data: "))
              .map((l) => l.slice(6))
              .join("\n");
            if (!data) continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed && parsed.type === "_hello" && typeof parsed.runId === "string") {
                setState((s) => ({ ...s, runId: parsed.runId }));
                continue;
              }
              setState((s) => ({ ...s, events: [...s.events, parsed as RunEvent] }));
              if (parsed?.type === "done") {
                setState((s) => ({ ...s, done: true }));
                onDone?.();
              }
            } catch {
              /* ignore */
            }
          }
        }
        setState((s) => ({ ...s, done: true }));
        onDone?.();
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setState((s) => ({
          ...s,
          done: true,
          error: err instanceof Error ? err.message : String(err),
        }));
        onDone?.();
      }
    })();

    return () => {
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function answerQuestion(questionId: string, answer: string) {
    if (!state.runId) return;
    setState((s) => ({ ...s, answers: { ...s.answers, [questionId]: answer } }));
    await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: state.runId, questionId, answer }),
    });
  }

  async function sendMessage(text: string) {
    if (!state.runId) return;
    setState((s) => ({
      ...s,
      events: [...s.events, { type: "thought", text: `**You:** ${text}` }],
    }));
    await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: state.runId, text }),
    });
  }

  return { state, answerQuestion, sendMessage };
}
