"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, User, Repeat } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import type { RunRow } from "@/lib/db/runs";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/runs");
      const data = await res.json();
      setRuns(data.runs ?? []);
    })();
  }, []);

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-line bg-bg/80 px-5 py-3 backdrop-blur">
          <h1 className="text-[14px] font-semibold tracking-tight text-fg">All runs</h1>
          <Link href="/" className="text-[11.5px] text-fg-2 hover:text-fg">
            Back to chat →
          </Link>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-4xl">
            {runs === null ? (
              <p className="text-sm text-fg-3">Loading…</p>
            ) : runs.length === 0 ? (
              <p className="text-sm text-fg-3">No runs yet.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-line bg-bg">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-bg-1">
                    <tr>
                      <Th>When</Th>
                      <Th>Trigger</Th>
                      <Th>Status</Th>
                      <Th align="right">Cost</Th>
                      <Th align="right">Tokens</Th>
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
                        <td className="px-3 py-1.5">
                          <span className="inline-flex items-center gap-1.5 text-fg-2">
                            {r.trigger === "cron" ? (
                              <Calendar className="h-3 w-3 text-accent" />
                            ) : r.trigger === "replay" ? (
                              <Repeat className="h-3 w-3 text-fg-3" />
                            ) : (
                              <User className="h-3 w-3 text-fg-3" />
                            )}
                            {r.trigger}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <StatusPill status={r.status} />
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular text-fg-1">
                          {r.total_cost_usd != null ? `$${r.total_cost_usd.toFixed(4)}` : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular text-fg-2">
                          {r.total_tokens ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-fg-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function StatusPill({ status }: { status: string }) {
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
