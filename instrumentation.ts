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

  try {
    const { prefetchKnowledge } = await import("@/lib/agent/knowledge-loader");
    await prefetchKnowledge();
  } catch (err) {
    console.error(
      `[instrumentation] knowledge prefetch threw: ${err instanceof Error ? err.message : String(err)}`
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
}
