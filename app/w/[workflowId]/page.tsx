"use client";

import { use as usePromise, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Calendar, Play, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import type { Workflow } from "@/lib/workflow/schema";
import type { RunRow } from "@/lib/db/runs";

interface PageProps {
  params: Promise<{ workflowId: string }>;
}

/**
 * Workflow detail surface — read-only metadata + Run-now button + recent runs.
 * Workflow runs are non-interactive: clicking Run-now starts a manual run and
 * navigates the user to /r/[runId] where they watch (live polling) or replay.
 */
export default function WorkflowDetailPage({ params }: PageProps) {
  const router = useRouter();
  const { workflowId } = usePromise(params);
  const [wf, setWf] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [wfRes, runsRes] = await Promise.all([
      fetch(`/api/workflows/${workflowId}`),
      fetch(`/api/runs?workflow=${workflowId}`),
    ]);
    if (!wfRes.ok) {
      setNotFound(true);
      return;
    }
    const wfData = await wfRes.json();
    setWf(wfData.workflow as Workflow);
    if (runsRes.ok) {
      const runsData = await runsRes.json();
      setRuns((runsData.runs as RunRow[]) ?? []);
    }
  }, [workflowId]);

  useEffect(() => {
    // Mount-time fetch; setState lives inside `load`. The rule below assumes
    // setState in an effect is suspicious, but this is a legit hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const runNow = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Start the run via POST /api/run; we only need the runId from _hello,
      // then navigate to /r/[runId] for the live view. The SDK keeps streaming
      // server-side until completion.
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId }),
      });
      if (!res.ok || !res.body) {
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      // Read just enough to see the _hello frame, then disconnect — the run
      // continues server-side because the request signal isn't aborted by us.
      // Wait, request signal IS aborted when we cancel the reader. We need a
      // different approach: keep the reader open in the background or use a
      // separate "kick off run" endpoint.
      // Simpler: read and discard until done. The /r/[runId] page then polls
      // the server-side state.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const m = buf.match(/data: (\{[^\n]+\})\n\n/);
        if (m) {
          try {
            const parsed = JSON.parse(m[1]);
            if (parsed?.type === "_hello" && typeof parsed.runId === "string") {
              router.push(`/r/${parsed.runId}`);
              // Keep draining the stream in the background so the request
              // doesn't get aborted prematurely.
              void drainQuietly(reader);
              return;
            }
          } catch {}
        }
      }
    } finally {
      setBusy(false);
    }
  }, [busy, workflowId, router]);

  const remove = useCallback(async () => {
    if (!wf) return;
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    await fetch(`/api/workflows/${wf.id}`, { method: "DELETE" });
    router.push("/");
  }, [wf, router]);

  if (notFound) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm text-fg-2">
          <div className="space-y-2 text-center">
            <p>Workflow not found.</p>
            <Link href="/" className="text-accent hover:underline">
              Back to home
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!wf) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm text-fg-3">
          Loading…
        </div>
      </AppShell>
    );
  }

  const cron = wf.triggers?.cron;
  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-line bg-bg/80 px-5 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/" className="rounded-md p-1 text-fg-3 hover:bg-bg-2 hover:text-fg-1">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-[14px] font-semibold tracking-tight text-fg">{wf.name}</h1>
              <p className="truncate text-[11.5px] text-fg-3">{wf.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={remove}
              className="rounded-md p-1.5 text-fg-3 transition-colors hover:bg-bg-2 hover:text-bad"
              title="Delete workflow"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={runNow}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-[12px] font-medium text-bg hover:bg-fg-1 disabled:bg-bg-3 disabled:text-fg-3"
            >
              <Play className="h-3 w-3" />
              {busy ? "Starting…" : "Run now"}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {cron ? (
              <div className="inline-flex items-center gap-2 rounded-md border border-line bg-bg-1 px-3 py-1.5 text-[11.5px]">
                <Calendar className="h-3 w-3 text-accent" />
                <span className="font-mono tabular text-fg-1">{cron}</span>
                <span className="text-fg-3">{wf.triggers?.timezone ?? "UTC"}</span>
                {wf.triggers?.enabled === false ? <span className="text-bad">· disabled</span> : null}
              </div>
            ) : null}

            <section>
              <h2 className="eyebrow mb-2">Steps</h2>
              <ol className="space-y-1 rounded-md border border-line bg-bg px-5 py-3 text-[13.5px]">
                {wf.steps.map((s, i) => (
                  <li key={s.id} className="flex gap-3 text-fg-1">
                    <span className="font-mono tabular text-[11px] text-fg-4 pt-0.5 w-5 shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1">{s.description}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h2 className="eyebrow mb-2">Recent runs</h2>
              {runs.length === 0 ? (
                <div className="rounded-md border border-line bg-bg px-3 py-3 text-[13px] text-fg-3">
                  No runs yet — click <span className="font-medium text-fg-1">Run now</span> above.
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-line bg-bg">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-bg-1">
                      <tr>
                        <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-fg-3">When</th>
                        <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-fg-3">Trigger</th>
                        <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-fg-3">Status</th>
                        <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-fg-3">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id} className="border-t border-line">
                          <td className="px-3 py-1.5">
                            <Link href={`/r/${r.id}`} className="text-fg-1 hover:text-accent hover:underline">
                              {new Date(r.started_at).toLocaleString()}
                            </Link>
                          </td>
                          <td className="px-3 py-1.5 text-fg-2">{r.trigger}</td>
                          <td className="px-3 py-1.5">
                            <RunStatus status={r.status} />
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular text-fg-1">
                            {r.total_cost_usd != null ? `$${r.total_cost_usd.toFixed(4)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function RunStatus({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "text-good"
      : status === "running"
      ? "text-accent"
      : status === "needs_input"
      ? "text-warn"
      : status === "error"
      ? "text-bad"
      : "text-fg-2";
  return <span className={`font-medium ${tone}`}>{status}</span>;
}

async function drainQuietly(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    /* ignore */
  }
}
