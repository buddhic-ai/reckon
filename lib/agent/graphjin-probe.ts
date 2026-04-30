import { env } from "@/lib/env";
import { prefetchKnowledge } from "./knowledge-loader";

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_INTERVAL_MS = 60_000;

export interface ProbeState {
  ok: boolean;
  latencyMs: number | null;
  checkedAt: string;
  error?: string;
}

declare global {
  var __reckonGraphjinProbe:
    | {
        state: ProbeState | null;
        timer: NodeJS.Timeout | null;
        wasOk: boolean;
        prefetchInFlight: boolean;
      }
    | undefined;
}

function slot() {
  if (!globalThis.__reckonGraphjinProbe) {
    globalThis.__reckonGraphjinProbe = {
      state: null,
      timer: null,
      wasOk: false,
      prefetchInFlight: false,
    };
  }
  return globalThis.__reckonGraphjinProbe;
}

async function probeOnce(): Promise<ProbeState> {
  // GraphJin's /health endpoint returns HTTP 500 with body "All's Well" even
  // when functionally healthy. /healthz is the correct liveness endpoint.
  const url = `${env.graphjinBaseUrl()}/healthz`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      return {
        ok: false,
        latencyMs: null,
        checkedAt,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { ok: true, latencyMs: Date.now() - start, checkedAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs: null, checkedAt, error: msg };
  } finally {
    clearTimeout(t);
  }
}

async function tick(): Promise<void> {
  const s = slot();
  try {
    const state = await probeOnce();
    s.state = state;

    if (state.ok && !s.wasOk) {
      // Down → up transition: re-fetch knowledge so the agent has fresh
      // discovery JSON. Guard against overlapping prefetches.
      if (!s.prefetchInFlight) {
        s.prefetchInFlight = true;
        try {
          const result = await prefetchKnowledge();
          if (result.ok) {
            console.error("[probe] graphjin recovered; knowledge re-prefetched");
          } else {
            console.error(`[probe] graphjin recovered but re-prefetch failed: ${result.error ?? "unknown"}`);
          }
        } catch (err) {
          console.error(
            `[probe] re-prefetch threw: ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          s.prefetchInFlight = false;
        }
      }
    } else if (!state.ok && s.wasOk) {
      console.error(`[probe] graphjin became unreachable: ${state.error ?? "unknown"}`);
    }

    s.wasOk = state.ok;
  } catch (err) {
    // Belt-and-braces: tick() must never throw, or setInterval keeps a
    // crashed promise rejection visible without the timer dying.
    console.error(
      `[probe] tick threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Set the probe's "previously seen ok" baseline based on the boot-time
 * prefetch result. Call this once from instrumentation.ts before
 * startGraphjinProbe(), so we don't trigger a redundant re-prefetch on the
 * first probe when GraphJin was already up at boot.
 */
export function setProbeBaseline(bootPrefetchOk: boolean): void {
  slot().wasOk = bootPrefetchOk;
}

/**
 * Begin probing GRAPHJIN_BASE_URL/health every PROBE_INTERVAL_MS. Idempotent —
 * a second call is a no-op. HMR-safe via globalThis.
 */
export function startGraphjinProbe(): void {
  const s = slot();
  if (s.timer) return;
  void tick();
  s.timer = setInterval(() => void tick(), PROBE_INTERVAL_MS);
}

export function getGraphjinProbeState(): ProbeState | null {
  return slot().state;
}
