#!/usr/bin/env -S node --experimental-strip-types
/**
 * Temp-DB smoke test for the memory layer.
 *
 * Spins up a fresh SQLite DB at a tmp path, exercises remember / search /
 * archive search / forget, and validates the runner's core-memory injection
 * snippet. Independent of the dev server.
 *
 * Usage:
 *   pnpm exec tsx scripts/memory-smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ulid } from "ulid";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reckon-memsmoke-"));
const dbPath = path.join(tmpDir, "agent.db");
process.env.AGENT_DB_PATH = dbPath;

import { getDb } from "@/lib/db/client";
import {
  rememberMemory,
  archiveMemory,
  getCoreMemories,
  searchLongTermMemory,
  formatMemoryPromptContext,
  findConflictingMemories,
  listAllMemories,
} from "@/lib/db/memories";
import {
  acceptPendingMemory,
  declinePendingMemory,
  listAllPending,
  listPendingForChat,
  listPendingForRun,
  listPendingForWorkflow,
} from "@/lib/db/pendingMemories";
import {
  dispatchMemoryDrafts,
  type MemoryDraft,
} from "@/lib/agent/auto-memory";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

function main(): number {
  const db = getDb();
  console.log("== memory smoke ==");
  console.log(`db: ${dbPath}\n`);

  // 1. remember + retrieve as core
  const pref = rememberMemory({
    kind: "preference",
    text: "Show revenue in INR lakhs unless asked otherwise.",
  });
  check("remember preference returns id", typeof pref.id === "string" && pref.id.length > 0);
  check("preference is pinned by default", pref.pinned === true);
  check("preference scope defaults to global", pref.scope === "global");

  const wfId = ulid();
  const wfNote = rememberMemory({
    kind: "metric_definition",
    text: "Active customer = ordered in last 90 days.",
    workflowId: wfId,
    scope: "workflow",
  });
  check("workflow metric_definition stores scope_id", wfNote.scopeId === wfId);

  const core = getCoreMemories({ workflowId: wfId });
  check(
    "core memories include the global preference",
    core.some((m) => m.id === pref.id)
  );
  check(
    "core memories include the workflow metric_definition",
    core.some((m) => m.id === wfNote.id)
  );

  const promptBlock = formatMemoryPromptContext({ workflowId: wfId });
  check(
    "prompt block lists the preference text",
    promptBlock.includes("INR lakhs")
  );
  check(
    "prompt block lists the metric definition",
    promptBlock.includes("Active customer")
  );

  // 2. search saved memory by token
  const savedHit = searchLongTermMemory({
    query: "active customer definition",
    workflowId: wfId,
  });
  check(
    "search finds the metric_definition",
    savedHit.saved.some((r) => r.memory.id === wfNote.id),
    savedHit.saved.map((r) => ({ id: r.memory.id, score: r.score }))
  );

  // 3. archive search via run_events
  const runId = ulid();
  const chatId = ulid();
  db.prepare(
    `INSERT INTO chats (id, title, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(chatId, "old chat", null, new Date().toISOString(), new Date().toISOString());
  db.prepare(
    `INSERT INTO runs (id, workflow_id, chat_id, kind, trigger, started_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(runId, wfId, chatId, "runner", "manual", new Date().toISOString(), "completed");
  db.prepare(
    `INSERT INTO run_events (run_id, ts, type, payload_json) VALUES (?, ?, ?, ?)`
  ).run(
    runId,
    new Date().toISOString(),
    "user_message",
    JSON.stringify({
      type: "user_message",
      text: "From now on, treat orders from the qa+ test domain as test customers.",
    })
  );
  db.prepare(
    `INSERT INTO run_events (run_id, ts, type, payload_json) VALUES (?, ?, ?, ?)`
  ).run(
    runId,
    new Date().toISOString(),
    "result",
    JSON.stringify({ type: "result", ok: true, text: "Acknowledged. Excluding qa+ test domain." })
  );

  const archiveHit = searchLongTermMemory({
    query: "qa test domain",
    workflowId: wfId,
  });
  check(
    "archive search finds historical user_message",
    archiveHit.archives.some((r) => r.runId === runId && r.eventType === "user_message"),
    archiveHit.archives
  );

  // 4. archive (forget) a saved memory
  const forgot = archiveMemory(wfNote.id, { reason: "test" });
  check("archiveMemory returns true", forgot === true);
  const coreAfterForget = getCoreMemories({ workflowId: wfId });
  check(
    "forgotten memory no longer in core",
    !coreAfterForget.some((m) => m.id === wfNote.id)
  );
  const searchAfterForget = searchLongTermMemory({
    query: "active customer definition",
    workflowId: wfId,
  });
  check(
    "forgotten memory no longer in saved search",
    !searchAfterForget.saved.some((r) => r.memory.id === wfNote.id)
  );
  check(
    "double-forget returns false",
    archiveMemory(wfNote.id) === false
  );

  // 5. memory_events audit trail recorded
  const eventCount = db
    .prepare("SELECT COUNT(*) AS n FROM memory_events WHERE memory_id = ?")
    .get(wfNote.id) as { n: number };
  check(
    "memory_events captured remember + search_hit + forget for the metric_definition",
    eventCount.n >= 3,
    eventCount
  );

  // 6. Conflict detection
  const conflictWfId = ulid();
  rememberMemory({
    kind: "metric_definition",
    text: "Active customer = ordered in the last 90 days.",
    workflowId: conflictWfId,
    scope: "workflow",
  });
  const conflictNoOverlap = findConflictingMemories({
    text: "Operator prefers dark mode in the dashboard.",
    kind: "metric_definition",
    scope: "workflow",
    scopeId: conflictWfId,
  });
  check("no conflict on unrelated text", conflictNoOverlap.length === 0);

  const conflictHit = findConflictingMemories({
    text: "An active customer is one who has ordered within the last 90 days.",
    kind: "metric_definition",
    scope: "workflow",
    scopeId: conflictWfId,
  });
  check(
    "conflict detector finds same-scope same-kind overlap",
    conflictHit.length === 1 && conflictHit[0].similarity > 0.4,
    conflictHit
  );

  const conflictDifferentScope = findConflictingMemories({
    text: "An active customer is one who has ordered within the last 90 days.",
    kind: "metric_definition",
    scope: "workflow",
    scopeId: ulid(), // different workflow
  });
  check(
    "conflict detector ignores other workflow scopes",
    conflictDifferentScope.length === 0
  );

  // 7. Auto-memory dispatcher routing
  const dispatchWfId = ulid();
  const dispatchChatId = ulid();
  const dispatchRunId = ulid();
  db.prepare(
    `INSERT INTO chats (id, title, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(dispatchChatId, "dispatch chat", null, new Date().toISOString(), new Date().toISOString());

  const drafts: MemoryDraft[] = [
    {
      text: "Always include the report date range in the header summary.",
      kind: "preference",
      scope: "global",
      confidence: 0.95,
    },
    {
      text: "For this workflow, treat orders from the qa+ test domain as test customers.",
      kind: "business_rule",
      scope: "workflow",
      confidence: 0.6,
      reasoning: "Plausible but ambiguous scope.",
    },
  ];

  // off mode: no work
  const offResult = dispatchMemoryDrafts(
    drafts,
    { workflowId: dispatchWfId, chatId: dispatchChatId, runId: dispatchRunId },
    "off"
  );
  check(
    "dispatcher in off mode writes nothing",
    offResult.saved.length === 0 && offResult.pending.length === 0
  );

  // on mode: high-confidence saves directly, low-confidence goes to pending
  const onResult = dispatchMemoryDrafts(
    drafts,
    { workflowId: dispatchWfId, chatId: dispatchChatId, runId: dispatchRunId },
    "on"
  );
  check(
    "dispatcher saves the high-confidence preference directly",
    onResult.saved.length === 1 && onResult.saved[0].text.includes("date range")
  );
  check(
    "dispatcher routes the ambiguous draft to pending",
    onResult.pending.length === 1 &&
      onResult.pending[0].draftScope === "workflow" &&
      onResult.pending[0].draftScopeId === dispatchWfId
  );

  // propose mode: nothing goes straight to memories — even high-confidence
  const proposeOnly = dispatchMemoryDrafts(
    [
      {
        text: "Always include net-of-returns when reporting sales.",
        kind: "business_rule",
        scope: "global",
        confidence: 0.97,
      },
    ],
    { workflowId: dispatchWfId, chatId: dispatchChatId, runId: dispatchRunId },
    "propose"
  );
  check(
    "propose mode never auto-saves",
    proposeOnly.saved.length === 0 && proposeOnly.pending.length === 1
  );

  // 8. Conflict + high-confidence draft is downgraded to pending
  const conflictDraftResult = dispatchMemoryDrafts(
    [
      {
        text: "Show revenue in INR lakhs by default when reporting.",
        kind: "preference",
        scope: "global",
        confidence: 0.96,
      },
    ],
    { workflowId: dispatchWfId, chatId: dispatchChatId, runId: dispatchRunId },
    "on"
  );
  check(
    "high-confidence draft with a conflict is held for operator review",
    conflictDraftResult.saved.length === 0 &&
      conflictDraftResult.pending.length === 1 &&
      conflictDraftResult.pending[0].conflicts.length >= 1
  );

  // 9. Pending lookups by surface
  const chatPending = listPendingForChat(dispatchChatId);
  check(
    "listPendingForChat returns drafts from this chat",
    chatPending.length >= 1
  );
  const runPending = listPendingForRun(dispatchRunId);
  check(
    "listPendingForRun returns drafts from this run",
    runPending.length >= 1
  );
  const wfRunPending = listPendingForWorkflow(dispatchWfId);
  // chat-attached drafts shouldn't show on workflow surface
  check(
    "listPendingForWorkflow filters out chat-attached drafts",
    wfRunPending.length === 0
  );

  // 10. Accept / decline workflow
  const ambiguous = onResult.pending[0];
  const accepted = acceptPendingMemory({ id: ambiguous.id });
  check(
    "accept writes a new memory and marks pending as accepted",
    accepted.pending.status === "accepted" &&
      accepted.memory.text.includes("qa+ test domain")
  );
  const allAfterAccept = listAllMemories();
  check(
    "accepted memory is visible in listAllMemories",
    allAfterAccept.some((m) => m.id === accepted.memory.id)
  );

  const declineTarget = conflictDraftResult.pending[0];
  const declined = declinePendingMemory(declineTarget.id, "duplicate");
  check(
    "decline marks pending as declined without writing a memory",
    declined.status === "declined" &&
      !listAllMemories().some(
        (m) => m.text === "Show revenue in INR lakhs by default when reporting."
      )
  );

  // Resolve the leftover propose-only row before asserting cleanliness — the
  // earlier `proposeOnly` dispatch left it behind by design (propose mode
  // never auto-saves, only queues).
  declinePendingMemory(proposeOnly.pending[0].id, "test cleanup");

  // No proposed rows should remain untouched after the round-trip
  const stillProposed = listAllPending({ status: "proposed" });
  check(
    "no leftover proposed pending rows after accept + decline",
    stillProposed.length === 0,
    stillProposed.map((p) => p.id)
  );

  // Re-accepting a finalized row should error
  let reacceptThrew = false;
  try {
    acceptPendingMemory({ id: ambiguous.id });
  } catch {
    reacceptThrew = true;
  }
  check("re-accepting a finalized pending throws", reacceptThrew);

  console.log("");
  console.log(`${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

const code = main();
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  // best effort
}
process.exit(code);
