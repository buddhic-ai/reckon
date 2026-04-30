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
}

export function closeDb(): void {
  if (globalThis[KEY]) {
    globalThis[KEY]!.close();
    globalThis[KEY] = undefined;
  }
}
