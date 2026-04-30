import { getDb } from "./client";

export interface ChatRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export function createChat(id: string): ChatRow {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, NULL, ?, ?)`
  ).run(id, now, now);
  return { id, title: null, created_at: now, updated_at: now };
}

export function getChat(id: string): ChatRow | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as ChatRow | undefined) ?? null;
}

export function listChats(limit = 50): ChatRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM chats ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as ChatRow[];
}

export function setChatTitleIfBlank(id: string, title: string): void {
  const db = getDb();
  const trimmed = title.trim().slice(0, 80);
  if (!trimmed) return;
  db.prepare(
    `UPDATE chats SET title = ? WHERE id = ? AND (title IS NULL OR title = '')`
  ).run(trimmed, id);
}

export function touchChat(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id
  );
}

export function deleteChat(id: string): void {
  const db = getDb();
  // Cascade: delete events for this chat's runs, then runs, then chat row.
  db.transaction(() => {
    const runIds = (db
      .prepare("SELECT id FROM runs WHERE chat_id = ?")
      .all(id) as { id: string }[]).map((r) => r.id);
    const evDel = db.prepare("DELETE FROM run_events WHERE run_id = ?");
    for (const rid of runIds) evDel.run(rid);
    db.prepare("DELETE FROM runs WHERE chat_id = ?").run(id);
    db.prepare("DELETE FROM chats WHERE id = ?").run(id);
  })();
}
