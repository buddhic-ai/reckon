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
} from "@/lib/db/memories";

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
