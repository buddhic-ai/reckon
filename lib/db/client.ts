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
  if (globalThis[KEY]) return globalThis[KEY]!;
  const dbPath = env.dbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const ddl = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.sql"), "utf8");
  db.exec(ddl);
  globalThis[KEY] = db;
  return db;
}

export function closeDb(): void {
  if (globalThis[KEY]) {
    globalThis[KEY]!.close();
    globalThis[KEY] = undefined;
  }
}
