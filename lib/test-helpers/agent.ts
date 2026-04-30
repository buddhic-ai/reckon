import type { RunEvent } from "@/lib/runtime/event-types";

export interface RunAgentResult {
  ok: boolean;
  finalText: string;
  events: RunEvent[];
  errorMessage?: string;
  durationMs: number;
}

/**
 * Hit the running dev server's /api/run, parse the SSE stream, and return
 * once 'done' arrives or the connection ends.
 */
export async function runAgentViaHttp(opts: {
  baseUrl: string;
  workflowId: string;
  initialUserMessage: string;
  timeoutMs?: number;
}): Promise<RunAgentResult> {
  const t0 = Date.now();
  const events: RunEvent[] = [];
  let finalText = "";
  let errorMessage: string | undefined;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 240_000);
  try {
    const res = await fetch(`${opts.baseUrl}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId: opts.workflowId,
        initialUserMessage: opts.initialUserMessage,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      return {
        ok: false,
        finalText: "",
        events,
        errorMessage: `HTTP ${res.status} ${res.statusText}`,
        durationMs: Date.now() - t0,
      };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let done = false;
    while (!done) {
      const { value, done: rdone } = await reader.read();
      if (rdone) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = frame.split("\n").filter((l) => l.startsWith("data: "));
        if (lines.length === 0) continue;
        const payload = lines.map((l) => l.slice(6)).join("\n");
        try {
          const parsed = JSON.parse(payload);
          if (parsed?.type === "_hello") continue;
          events.push(parsed as RunEvent);
          if (parsed?.type === "result") {
            finalText = parsed.text ?? "";
          }
          if (parsed?.type === "error") {
            errorMessage = parsed.message ?? "agent error";
          }
          if (parsed?.type === "done") {
            done = true;
            break;
          }
        } catch {
          /* ignore non-JSON frames */
        }
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timeout);
  }

  return {
    ok: !errorMessage && finalText.length > 0,
    finalText,
    events,
    errorMessage,
    durationMs: Date.now() - t0,
  };
}

/**
 * Ensure an "Analyst" workflow exists for the smoke test runs, returning
 * its id. Idempotent — looks up by name first.
 */
export async function ensureAnalystWorkflow(baseUrl: string): Promise<string> {
  const list = await fetch(`${baseUrl}/api/workflows`).then((r) => r.json());
  const found = (list.workflows as Array<{ id: string; name: string }>).find(
    (w) => w.name === "Smoke Test Analyst"
  );
  if (found) return found.id;
  const created = await fetch(`${baseUrl}/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Test Analyst",
      description:
        "Single-question analyst used by the smoke test harness. Answers one business question per run.",
      systemPromptOverlay: SMOKE_OVERLAY,
      steps: [
        { id: "s1", description: "Read the user's question." },
        {
          id: "s2",
          description:
            "If the question is about specific data, run one or two graphjin queries to find the answer. Consult lib/agent/knowledge/schema.json and insights.json first.",
        },
        {
          id: "s3",
          description:
            "Reply with a short markdown answer that explicitly names the key values (numbers, names, places). Do NOT ask the user follow-up questions — make a sensible interpretation and proceed.",
        },
      ],
    }),
  }).then((r) => r.json());
  if (!created.ok || !created.workflow?.id) {
    throw new Error(`Failed to create analyst workflow: ${JSON.stringify(created)}`);
  }
  return created.workflow.id;
}

const SMOKE_OVERLAY = `You are answering a SINGLE business question against the connected database.

Rules:
- Make at most 3 graphjin cli calls. Prefer one bulk query over many small ones.
- Do NOT ask the user follow-up questions. Make a reasonable interpretation
  and proceed.
- Reply with a SHORT markdown answer (5 lines or fewer) that explicitly
  names the concrete values you found — numbers, names, places. The smoke
  harness checks for these as substrings.
- Numbers should appear as digits ("206953", "92.25", not "two hundred
  thousand"). Don't insert thousand separators inside the digits — write
  "4251368.55" rather than "4,251,368.55" to keep substring matching robust.
- If the database returns nothing, say so plainly.`;
