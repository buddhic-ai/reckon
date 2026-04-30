/**
 * Next.js server-startup hook. Runs once on the server process, before any
 * request is handled. Perfect for one-shot initialisation:
 *   - prefetch GraphJin discovery JSON into lib/agent/knowledge/
 *   - register cron jobs for all workflows with triggers.cron set
 *
 * Failures are logged but do not block startup. The /api/health route surfaces
 * any degraded subsystems.
 */
export async function register() {
  // Skip in the edge runtime; this hook also fires there.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  let bootPrefetchOk = false;
  try {
    const { prefetchKnowledge } = await import("@/lib/agent/knowledge-loader");
    const result = await prefetchKnowledge();
    bootPrefetchOk = result.ok;
  } catch (err) {
    console.error(
      `[instrumentation] knowledge prefetch threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    const { setProbeBaseline, startGraphjinProbe } = await import(
      "@/lib/agent/graphjin-probe"
    );
    setProbeBaseline(bootPrefetchOk);
    startGraphjinProbe();
  } catch (err) {
    console.error(
      `[instrumentation] graphjin probe init threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    const { ensureAdHocAnalystWorkflow } = await import("@/lib/agent/seed-adhoc");
    ensureAdHocAnalystWorkflow();
  } catch (err) {
    console.error(
      `[instrumentation] adhoc analyst seed threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    const { initScheduler } = await import("@/lib/scheduler/init");
    initScheduler();
  } catch (err) {
    console.error(
      `[instrumentation] scheduler init threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Fire-and-forget: regenerate home-screen suggestion chips if the connected
  // DB's fingerprint isn't already cached. Doesn't block boot — the home page
  // falls back to the most recent cached chips (or a generic set) until this
  // lands.
  if (bootPrefetchOk) {
    try {
      const { ensureSuggestionsAtBoot } = await import("@/lib/home/ensure-suggestions");
      ensureSuggestionsAtBoot();
    } catch (err) {
      console.error(
        `[instrumentation] home suggestions threw: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
