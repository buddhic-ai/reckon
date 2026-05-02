import cron, { type ScheduledTask } from "node-cron";
import { ulid } from "ulid";
import { env } from "@/lib/env";
import type { Workflow } from "@/lib/workflow/schema";
import { getWorkflow } from "@/lib/db/workflows";
import { createRun, finishRun, appendRunEvent } from "@/lib/db/runs";
import { AsyncMessageQueue } from "@/lib/runtime/async-queue";
import type { SDKUserMessageLike } from "@/lib/runtime/run-registry";
import { runWorkflow, makeHeadlessAskUser } from "@/lib/agent/runner";
import type { RunEvent } from "@/lib/runtime/event-types";

declare global {
  var __agentScheduler: Map<string, ScheduledTask> | undefined;
}

function jobs(): Map<string, ScheduledTask> {
  if (!globalThis.__agentScheduler) globalThis.__agentScheduler = new Map();
  return globalThis.__agentScheduler;
}

export function scheduleWorkflow(wf: Workflow): void {
  const cronExpr = wf.triggers?.cron;
  if (!cronExpr) return;
  if (wf.triggers?.enabled === false) {
    unscheduleWorkflow(wf.id);
    return;
  }
  if (!cron.validate(cronExpr)) {
    console.error(
      `[scheduler] workflow ${wf.id} has invalid cron expression "${cronExpr}" — skipping`
    );
    return;
  }
  unscheduleWorkflow(wf.id);
  const tz = wf.triggers?.timezone ?? env.defaultTimezone();
  const task = cron.schedule(
    cronExpr,
    () => {
      void fireScheduledRun(wf.id).catch((err) => {
        console.error(
          `[scheduler] fireScheduledRun(${wf.id}) threw: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    },
    { timezone: tz }
  );
  jobs().set(wf.id, task);
  console.error(
    `[scheduler] scheduled ${wf.id} (${wf.name}) cron="${cronExpr}" tz=${tz}`
  );
}

export function unscheduleWorkflow(workflowId: string): void {
  const j = jobs();
  const t = j.get(workflowId);
  if (t) {
    t.stop();
    j.delete(workflowId);
  }
}

export function activeJobIds(): string[] {
  return Array.from(jobs().keys());
}

async function fireScheduledRun(workflowId: string): Promise<void> {
  const wf = getWorkflow(workflowId);
  if (!wf) {
    console.error(`[scheduler] workflow ${workflowId} no longer exists; unscheduling`);
    unscheduleWorkflow(workflowId);
    return;
  }
  const runId = ulid();
  createRun({ id: runId, workflowId: wf.id, kind: "runner", trigger: "cron" });

  const emit = (event: RunEvent) => {
    appendRunEvent(runId, event);
  };
  const messageQueue = new AsyncMessageQueue<SDKUserMessageLike>();
  // Seed the agent with a one-line user message announcing the scheduled fire.
  messageQueue.push({
    type: "user",
    message: {
      role: "user",
      content: `[scheduled run started at ${new Date().toISOString()}] Begin executing the workflow.`,
    },
    parent_tool_use_id: null,
  });
  messageQueue.close(); // headless: no further user input

  const abortController = new AbortController();
  const askUser = makeHeadlessAskUser(abortController);

  try {
    const result = await runWorkflow({
      workflow: wf,
      userMessages: messageQueue,
      emit,
      askUser,
      abortController,
      mode: "headless",
      runId,
    });
    finishRun({
      id: runId,
      status: result.status,
      errorMessage: result.errorMessage ?? null,
      totalTokens: result.totalTokens ?? null,
      totalCostUsd: result.totalCostUsd ?? null,
      resultSummary: result.finalText.slice(0, 4000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishRun({
      id: runId,
      status: "error",
      errorMessage: msg,
    });
  }
}
