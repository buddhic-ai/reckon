"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ChatThread } from "@/components/ChatThread";
import { PendingMemoryBanner } from "@/components/PendingMemoryBanner";
import type { RunEvent } from "@/lib/runtime/event-types";
import type { RunRow } from "@/lib/db/runs";

interface PageProps {
  params: Promise<{ runId: string }>;
}

/**
 * Read-only viewer for a single run (workflow trigger or chat turn).
 * Polls every 2s while the run is still `running` so live workflow runs
 * show progress without a dedicated SSE channel.
 */
export default function RunDetailPage({ params }: PageProps) {
  const { runId } = usePromise(params);
  const [data, setData] = useState<{ run: RunRow; events: RunEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const res = await fetch(`/api/runs/${runId}`);
      if (cancelled) return;
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const d = (await res.json()) as { run: RunRow; events: RunEvent[] };
      setData(d);
      if (d.run.status === "running") {
        timer = setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  if (error) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm">
          <div className="space-y-2 text-center">
            <p className="text-bad">{error}</p>
            <Link href="/runs" className="text-accent hover:underline">
              Back to runs
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm text-fg-3">
          Loading…
        </div>
      </AppShell>
    );
  }

  const { run, events } = data;
  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-line bg-bg/80 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Link href="/runs" className="rounded-md p-1 text-fg-3 hover:bg-bg-2 hover:text-fg-1">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-[14px] font-semibold tracking-tight text-fg">
                {run.chat_id ? "Chat turn" : "Workflow run"}
              </h1>
              <p className="text-[11px] text-fg-3">
                {run.trigger} · <RunStatusBadge status={run.status} /> ·{" "}
                {new Date(run.started_at).toLocaleString()}
              </p>
            </div>
          </div>
          {run.workflow_id && !run.chat_id ? (
            <Link
              href={`/w/${run.workflow_id}`}
              className="rounded-md bg-fg px-3 py-1.5 text-[12px] font-medium text-bg hover:bg-fg-1"
            >
              Run again
            </Link>
          ) : null}
        </header>
        <div className="shrink-0 border-b border-line bg-bg-1 px-5 py-1.5 font-mono text-[11px] tabular text-fg-3">
          {run.total_cost_usd != null ? `$${run.total_cost_usd.toFixed(4)}` : "—"}
          <span className="mx-2 text-fg-4">·</span>
          {run.total_tokens != null ? `${run.total_tokens.toLocaleString()} tokens` : "—"}
          {run.error_message ? (
            <span className="ml-2 text-bad">· {run.error_message}</span>
          ) : null}
        </div>
        <ChatThread events={events} showTools />
        {!run.chat_id && (
          <div className="shrink-0 border-t border-line bg-bg/80 px-5 py-3">
            <PendingMemoryBanner surface={{ kind: "run", runId }} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

function RunStatusBadge({ status }: { status: string }) {
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
