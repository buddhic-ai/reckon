import { listWorkflows } from "@/lib/db/workflows";
import { scheduleWorkflow } from "./cron";

declare global {
  var __agentSchedulerInited: boolean | undefined;
}

/**
 * Read every workflow with a cron trigger and register it with node-cron.
 * Idempotent: repeated calls are a no-op (the global flag prevents re-init,
 * and scheduleWorkflow itself replaces existing jobs for a given id).
 */
export function initScheduler(): void {
  if (globalThis.__agentSchedulerInited) return;
  globalThis.__agentSchedulerInited = true;
  try {
    const all = listWorkflows();
    let n = 0;
    for (const wf of all) {
      if (wf.triggers?.cron) {
        scheduleWorkflow(wf);
        n++;
      }
    }
    console.error(`[scheduler] init: ${n} cron job(s) registered (of ${all.length} total)`);
  } catch (err) {
    console.error(
      `[scheduler] init failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
