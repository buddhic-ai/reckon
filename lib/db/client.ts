import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

type Db = ReturnType<typeof Database>;

const KEY = "__agentDb" as const;

declare global {
  var __agentDb: Db | undefined;
}

export function getDb(): Db {
  if (globalThis[KEY]) {
    // The cached handle predates this process restart's schema.sql; re-run
    // idempotent migrations every time so newly-added tables / columns land
    // even when Next.js HMR has retained the global across module reloads.
    migrate(globalThis[KEY]!);
    return globalThis[KEY]!;
  }
  const dbPath = env.dbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const ddl = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.sql"), "utf8");
  db.exec(ddl);
  migrate(db);
  globalThis[KEY] = db;
  return db;
}

function migrate(db: Db): void {
  const cols = db
    .prepare("PRAGMA table_info(chats)")
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "session_id")) {
    db.exec("ALTER TABLE chats ADD COLUMN session_id TEXT");
  }

  // Tables added after the initial release. Each statement is idempotent so
  // re-running on every getDb() is safe (and necessary to survive HMR).
  db.exec(`CREATE TABLE IF NOT EXISTS home_suggestions (
    fingerprint  TEXT PRIMARY KEY,
    json         TEXT NOT NULL,
    generated_at TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS memories (
    id             TEXT PRIMARY KEY,
    kind           TEXT NOT NULL,
    scope          TEXT NOT NULL,
    scope_id       TEXT,
    text           TEXT NOT NULL,
    pinned         INTEGER NOT NULL DEFAULT 0,
    confidence     REAL NOT NULL DEFAULT 0.8,
    metadata_json  TEXT NOT NULL DEFAULT '{}',
    source_run_id  TEXT,
    source_chat_id TEXT,
    use_count      INTEGER NOT NULL DEFAULT 0,
    last_used_at   TEXT,
    archived_at    TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(archived_at, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id, archived_at);
  CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(pinned, archived_at, updated_at DESC);

  CREATE TABLE IF NOT EXISTS memory_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id    TEXT,
    run_id       TEXT,
    chat_id      TEXT,
    action       TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (memory_id) REFERENCES memories(id)
  );
  CREATE INDEX IF NOT EXISTS idx_memory_events_memory ON memory_events(memory_id, id DESC);

  CREATE TABLE IF NOT EXISTS pending_memories (
    id              TEXT PRIMARY KEY,
    chat_id         TEXT,
    run_id          TEXT,
    workflow_id     TEXT,
    status          TEXT NOT NULL,
    draft_text      TEXT NOT NULL,
    draft_kind      TEXT NOT NULL,
    draft_scope     TEXT NOT NULL,
    draft_scope_id  TEXT,
    confidence      REAL NOT NULL,
    reasoning       TEXT,
    conflict_json   TEXT,
    decision_text   TEXT,
    decided_at      TEXT,
    memory_id       TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pending_chat ON pending_memories(chat_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_memories(status, created_at DESC);`);
}

export function closeDb(): void {
  if (globalThis[KEY]) {
    globalThis[KEY]!.close();
    globalThis[KEY] = undefined;
  }
}
