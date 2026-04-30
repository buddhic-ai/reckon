"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

const POLL_MS = 30_000;

type GraphjinCheck =
  | { ok: true; latencyMs: number | null; checkedAt: string }
  | { ok: false; pending?: boolean; error?: string; checkedAt?: string };

interface HealthResponse {
  ok: boolean;
  checks: {
    graphjin?: GraphjinCheck;
  };
}

export function GraphjinStatusBanner() {
  const [state, setState] = useState<GraphjinCheck | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const json = (await res.json()) as HealthResponse;
        if (cancelled) return;
        setState(json.checks.graphjin ?? null);
      } catch {
        // Network error reaching our own API — leave prior state in place
        // rather than flash a banner for a transient blip.
      }
    }

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Hide while the first probe is still pending, and when GraphJin is healthy.
  if (!state || state.ok || ("pending" in state && state.pending)) return null;

  const detail = "error" in state && state.error ? state.error : "Unknown error";

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-bad-soft bg-bad-soft/60 px-4 py-2 text-[12.5px] text-bad">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">
        Database connection unavailable — workflow runs and the builder will
        fail until it&rsquo;s restored.
      </span>
      <span
        className="hidden truncate font-mono text-[11px] text-bad/80 sm:inline"
        title={detail}
      >
        {detail}
      </span>
    </div>
  );
}
