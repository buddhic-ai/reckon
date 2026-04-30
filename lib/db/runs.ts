import { getDb } from "./client";
import type { RunEvent } from "@/lib/runtime/event-types";

export type RunStatus = "running" | "completed" | "aborted" | "error" | "needs_input";
export type RunKind = "runner" | "builder";
export type RunTrigger = "manual" | "cron" | "replay";

export interface RunRow {
  id: string;
  workflow_id: string | null;
  chat_id: string | null;
  kind: RunKind;
  trigger: RunTrigger;
  started_at: string;
  ended_at: string | null;
  status: RunStatus;
  total_tokens: number | null;
  total_cost_usd: number | null;
  error_message: string | null;
  result_summary: string | null;
}

export interface CreateRunInput {
  id: string;
  workflowId: string | null;
  chatId?: string | null;
  kind: RunKind;
  trigger: RunTrigger;
}

export function createRun(input: CreateRunInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO runs (id, workflow_id, chat_id, kind, trigger, started_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'running')`
  ).run(
    input.id,
    input.workflowId,
    input.chatId ?? null,
    input.kind,
    input.trigger,
    new Date().toISOString()
  );
}

export interface FinishRunInput {
  id: string;
  status: RunStatus;
  errorMessage?: string | null;
  totalTokens?: number | null;
  totalCostUsd?: number | null;
  resultSummary?: string | null;
}

export function finishRun(input: FinishRunInput): void {
  const db = getDb();
  db.prepare(
    `UPDATE runs
     SET status = ?, ended_at = ?, error_message = ?, total_tokens = ?, total_cost_usd = ?, result_summary = ?
     WHERE id = ?`
  ).run(
    input.status,
    new Date().toISOString(),
    input.errorMessage ?? null,
    input.totalTokens ?? null,
    input.totalCostUsd ?? null,
    input.resultSummary ?? null,
    input.id
  );
}

export function getRun(id: string): RunRow | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined) ?? null;
}

export function deleteRun(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM run_events WHERE run_id = ?").run(id);
    db.prepare("DELETE FROM runs WHERE id = ?").run(id);
  })();
}

/**
 * Most recent run status per workflow, excluding chat turns. The Sidebar
 * uses this to colour each workflow's status dot (running=amber pulse,
 * completed=green, error/aborted=red, needs_input=amber static, missing=
 * grey "never run"). Only one row per workflow id.
 */
export function getLastWorkflowRunStatuses(): Map<string, RunStatus> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT workflow_id, status FROM (
         SELECT workflow_id, status,
                ROW_NUMBER() OVER (PARTITION BY workflow_id ORDER BY started_at DESC) AS rn
         FROM runs
         WHERE chat_id IS NULL AND workflow_id IS NOT NULL
       ) WHERE rn = 1`
    )
    .all() as { workflow_id: string; status: RunStatus }[];
  const out = new Map<string, RunStatus>();
  for (const r of rows) out.set(r.workflow_id, r.status);
  return out;
}

export interface ListRunsOpts {
  workflowId?: string;
  chatId?: string;
  limit?: number;
}

export function listRuns(opts: ListRunsOpts = {}): RunRow[] {
  const db = getDb();
  const limit = opts.limit ?? 100;
  if (opts.chatId) {
    return db
      .prepare("SELECT * FROM runs WHERE chat_id = ? ORDER BY started_at ASC LIMIT ?")
      .all(opts.chatId, limit) as RunRow[];
  }
  if (opts.workflowId) {
    return db
      .prepare("SELECT * FROM runs WHERE workflow_id = ? AND chat_id IS NULL ORDER BY started_at DESC LIMIT ?")
      .all(opts.workflowId, limit) as RunRow[];
  }
  return db
    .prepare("SELECT * FROM runs WHERE chat_id IS NULL ORDER BY started_at DESC LIMIT ?")
    .all(limit) as RunRow[];
}

/**
 * Concatenate run_events from every run in a chat, in chronological order.
 * Used for resuming a chat (replay UI + prior-context priming).
 */
export function getChatEvents(chatId: string): RunEvent[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT re.payload_json
       FROM run_events re
       JOIN runs r ON r.id = re.run_id
       WHERE r.chat_id = ?
       ORDER BY r.started_at ASC, re.id ASC`
    )
    .all(chatId) as { payload_json: string }[];
  return rows.map((r) => JSON.parse(r.payload_json) as RunEvent);
}

export function appendRunEvent(runId: string, event: RunEvent): void {
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO run_events (run_id, ts, type, payload_json) VALUES (?, ?, ?, ?)`
    ).run(runId, new Date().toISOString(), event.type, JSON.stringify(event));
  } catch {
    // never break the live stream because of a logging failure
  }
}

export interface RunEventRow {
  id: number;
  run_id: string;
  ts: string;
  type: string;
  payload_json: string;
}

export function getRunEvents(runId: string): RunEvent[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC")
    .all(runId) as RunEventRow[];
  return rows.map((r) => JSON.parse(r.payload_json) as RunEvent);
}

/**
 * Drop the run that owns chat-event #eventIndex, plus every later run in the
 * chat. Used by the user-message "retry from here" affordance: replay should
 * reflect the new branch only. Returns the number of runs deleted.
 */
export function truncateChatFromEventIndex(
  chatId: string,
  eventIndex: number
): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT re.run_id, r.started_at
       FROM run_events re
       JOIN runs r ON r.id = re.run_id
       WHERE r.chat_id = ?
       ORDER BY r.started_at ASC, re.id ASC`
    )
    .all(chatId) as { run_id: string; started_at: string }[];
  if (eventIndex < 0 || eventIndex >= rows.length) return 0;
  const target = rows[eventIndex];
  // Drop the target run plus every run in this chat that started at or after
  // it. We delete the whole owning run rather than just events past N, so a
  // mid-run retry still produces a clean branch.
  const runIds = db
    .prepare(`SELECT id FROM runs WHERE chat_id = ? AND started_at >= ?`)
    .all(chatId, target.started_at) as { id: string }[];
  const idSet = new Set<string>(runIds.map((r) => r.id));
  idSet.add(target.run_id);
  const evDel = db.prepare("DELETE FROM run_events WHERE run_id = ?");
  const runDel = db.prepare("DELETE FROM runs WHERE id = ?");
  const tx = db.transaction(() => {
    for (const id of idSet) {
      evDel.run(id);
      runDel.run(id);
    }
  });
  tx();
  return idSet.size;
}
