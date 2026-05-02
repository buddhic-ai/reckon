import { ulid } from "ulid";
import { getDb } from "./client";

type Db = ReturnType<typeof getDb>;

export const MEMORY_KINDS = [
  "preference",
  "business_rule",
  "metric_definition",
  "workflow_note",
  "correction",
  "company_context",
  "other",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_SCOPES = [
  "global",
  "workflow",
  "chat",
  "database",
] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export interface MemoryRow {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  scope_id: string | null;
  text: string;
  pinned: number;
  confidence: number;
  metadata_json: string;
  source_run_id: string | null;
  source_chat_id: string | null;
  use_count: number;
  last_used_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Memory {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  scopeId: string | null;
  text: string;
  pinned: boolean;
  confidence: number;
  metadata: Record<string, unknown>;
  sourceRunId: string | null;
  sourceChatId: string | null;
  useCount: number;
  lastUsedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryContext {
  workflowId?: string | null;
  chatId?: string | null;
  runId?: string | null;
}

export interface RememberMemoryInput extends MemoryContext {
  kind: MemoryKind;
  scope?: MemoryScope;
  scopeId?: string | null;
  text: string;
  pinned?: boolean;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  source: "saved_memory";
  memory: Memory;
  score: number;
}

export interface ArchiveSearchResult {
  source: "chat_archive" | "run_archive";
  runId: string;
  chatId: string | null;
  workflowId: string | null;
  eventType: "user_message" | "result";
  text: string;
  ts: string;
  score: number;
}

export interface SearchLongTermMemoryInput extends MemoryContext {
  query: string;
  limit?: number;
  includeArchives?: boolean;
}

interface ArchiveCandidateRow {
  run_id: string;
  chat_id: string | null;
  workflow_id: string | null;
  ts: string;
  type: "user_message" | "result";
  payload_json: string;
}

export function rememberMemory(input: RememberMemoryInput): Memory {
  const db = getDb();
  const now = new Date().toISOString();
  const scope = input.scope ?? defaultScope(input);
  const scopeId = resolveScopeId(scope, input);
  const id = ulid();
  const pinned = input.pinned ?? shouldPinByDefault(input.kind, scope);
  const confidence = clamp(input.confidence ?? 0.8, 0, 1);
  const metadata = input.metadata ?? {};

  db.transaction(() => {
    db.prepare(
      `INSERT INTO memories (
        id, kind, scope, scope_id, text, pinned, confidence, metadata_json,
        source_run_id, source_chat_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.kind,
      scope,
      scopeId,
      input.text.trim(),
      pinned ? 1 : 0,
      confidence,
      JSON.stringify(metadata),
      input.runId ?? null,
      input.chatId ?? null,
      now,
      now
    );
    insertMemoryEvent(db, {
      memoryId: id,
      runId: input.runId ?? null,
      chatId: input.chatId ?? null,
      action: "remember",
      payload: { kind: input.kind, scope, scopeId, pinned, text: input.text.trim() },
      createdAt: now,
    });
  })();

  return getMemory(id)!;
}

export function archiveMemory(
  id: string,
  ctx: MemoryContext & { reason?: string } = {}
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const res = db.transaction(() => {
    const update = db
      .prepare(`UPDATE memories SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`)
      .run(now, now, id);
    if (update.changes > 0) {
      insertMemoryEvent(db, {
        memoryId: id,
        runId: ctx.runId ?? null,
        chatId: ctx.chatId ?? null,
        action: "forget",
        payload: { reason: ctx.reason ?? null },
        createdAt: now,
      });
    }
    return update.changes > 0;
  })();
  return res;
}

export function getMemory(id: string): Memory | null {
  const row = getDb()
    .prepare("SELECT * FROM memories WHERE id = ?")
    .get(id) as MemoryRow | undefined;
  return row ? rowToMemory(row) : null;
}

export function getCoreMemories(ctx: MemoryContext = {}, limit = 16): Memory[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM memories
       WHERE archived_at IS NULL
         AND (
           pinned = 1
           OR (scope = 'global' AND kind IN ('preference', 'business_rule', 'metric_definition', 'company_context'))
           OR (scope = 'workflow' AND scope_id = ? AND kind IN ('business_rule', 'metric_definition', 'workflow_note'))
           OR (scope = 'chat' AND scope_id = ? AND pinned = 1)
         )
       ORDER BY pinned DESC, updated_at DESC
       LIMIT ?`
    )
    .all(ctx.workflowId ?? "", ctx.chatId ?? "", limit) as MemoryRow[];
  return rows.map(rowToMemory);
}

export function searchLongTermMemory(
  input: SearchLongTermMemoryInput
): { saved: MemorySearchResult[]; archives: ArchiveSearchResult[] } {
  const limit = clamp(Math.floor(input.limit ?? 8), 1, 20);
  const tokens = tokenize(input.query);
  const saved = searchSavedMemories(input, tokens, limit);
  const archives =
    input.includeArchives === false
      ? []
      : searchArchiveEvents(input, tokens, limit);

  if (saved.length > 0) {
    touchMemories(saved.map((r) => r.memory.id), input);
  }

  return { saved, archives };
}

export function formatMemoryPromptContext(ctx: MemoryContext = {}): string {
  const core = getCoreMemories(ctx);
  if (core.length === 0) {
    return "No core memories are currently saved for this workflow or operator.";
  }
  return [
    "Core memories that should be treated as durable context:",
    ...core.map((m) => `- [${m.id}] ${formatMemoryLabel(m)}: ${m.text}`),
  ].join("\n");
}

function searchSavedMemories(
  input: SearchLongTermMemoryInput,
  tokens: string[],
  limit: number
): MemorySearchResult[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM memories
       WHERE archived_at IS NULL
       ORDER BY pinned DESC, updated_at DESC
       LIMIT 1000`
    )
    .all() as MemoryRow[];

  const query = input.query.trim();
  return rows
    .map((row) => {
      const memory = rowToMemory(row);
      const score = scoreMemory(memory, query, tokens, input);
      return { source: "saved_memory" as const, memory, score };
    })
    .filter((r) => r.score > 0 || tokens.length === 0)
    .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt))
    .slice(0, limit);
}

function searchArchiveEvents(
  input: SearchLongTermMemoryInput,
  tokens: string[],
  limit: number
): ArchiveSearchResult[] {
  if (tokens.length === 0) return [];
  const where = tokens.map(() => "re.payload_json LIKE ?").join(" OR ");
  const params = [
    input.runId ?? null,
    input.runId ?? null,
    ...tokens.map((t) => `%${escapeLike(t)}%`),
  ];
  const rows = getDb()
    .prepare(
      `SELECT re.run_id, r.chat_id, r.workflow_id, re.ts, re.type, re.payload_json
       FROM run_events re
       JOIN runs r ON r.id = re.run_id
       WHERE re.type IN ('user_message', 'result')
         AND (? IS NULL OR re.run_id != ?)
         AND (${where})
       ORDER BY re.id DESC
       LIMIT 300`
    )
    .all(...params) as ArchiveCandidateRow[];

  return rows
    .map((row) => {
      const text = archiveText(row);
      if (!text) return null;
      const score = scoreArchive(text, row, input.query, tokens, input);
      if (score <= 0) return null;
      return {
        source: row.chat_id ? "chat_archive" : "run_archive",
        runId: row.run_id,
        chatId: row.chat_id,
        workflowId: row.workflow_id,
        eventType: row.type,
        text: truncate(text, 1200),
        ts: row.ts,
        score,
      } satisfies ArchiveSearchResult;
    })
    .filter((r): r is ArchiveSearchResult => r !== null)
    .sort((a, b) => b.score - a.score || b.ts.localeCompare(a.ts))
    .slice(0, limit);
}

function touchMemories(ids: string[], ctx: MemoryContext): void {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const touch = db.prepare(
    `UPDATE memories
     SET use_count = use_count + 1, last_used_at = ?, updated_at = updated_at
     WHERE id = ?`
  );
  const tx = db.transaction(() => {
    for (const id of unique) {
      touch.run(now, id);
      insertMemoryEvent(db, {
        memoryId: id,
        runId: ctx.runId ?? null,
        chatId: ctx.chatId ?? null,
        action: "search_hit",
        payload: {},
        createdAt: now,
      });
    }
  });
  tx();
}

function insertMemoryEvent(
  db: Db,
  input: {
    memoryId: string | null;
    runId: string | null;
    chatId: string | null;
    action: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }
): void {
  db.prepare(
    `INSERT INTO memory_events (memory_id, run_id, chat_id, action, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .run(
      input.memoryId,
      input.runId,
      input.chatId,
      input.action,
      JSON.stringify(input.payload),
      input.createdAt
    );
}

function rowToMemory(row: MemoryRow): Memory {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    scopeId: row.scope_id,
    text: row.text,
    pinned: row.pinned === 1,
    confidence: row.confidence,
    metadata,
    sourceRunId: row.source_run_id,
    sourceChatId: row.source_chat_id,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scoreMemory(
  memory: Memory,
  query: string,
  tokens: string[],
  ctx: MemoryContext
): number {
  let score = scoreText(memory.text, query, tokens);
  const label = `${memory.kind} ${memory.scope} ${memory.scopeId ?? ""}`;
  score += scoreText(label, query, tokens) * 0.4;
  if (memory.pinned) score += 3;
  if (memory.scope === "global") score += 1;
  if (memory.scope === "workflow" && memory.scopeId === ctx.workflowId) score += 3;
  if (memory.scope === "chat" && memory.scopeId === ctx.chatId) score += 3;
  return score;
}

function scoreArchive(
  text: string,
  row: ArchiveCandidateRow,
  query: string,
  tokens: string[],
  ctx: MemoryContext
): number {
  let score = scoreText(text, query, tokens);
  if (row.chat_id && row.chat_id === ctx.chatId) score += 2;
  if (row.workflow_id && row.workflow_id === ctx.workflowId) score += 2;
  if (row.type === "user_message") score += 1;
  return score;
}

function scoreText(text: string, query: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  const phrase = query.trim().toLowerCase();
  let score = phrase && lower.includes(phrase) ? 8 : 0;
  for (const t of tokens) {
    if (lower.includes(t)) score += 2;
  }
  return score;
}

function archiveText(row: ArchiveCandidateRow): string | null {
  try {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const text = payload.text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

function formatMemoryLabel(memory: Memory): string {
  const scope = memory.scopeId ? `${memory.scope}:${memory.scopeId}` : memory.scope;
  return `${memory.kind} (${scope})`;
}

function defaultScope(input: RememberMemoryInput): MemoryScope {
  if (input.workflowId && input.kind === "workflow_note") return "workflow";
  return "global";
}

function resolveScopeId(scope: MemoryScope, input: RememberMemoryInput): string | null {
  if (input.scopeId) return input.scopeId;
  if (scope === "workflow") return input.workflowId ?? null;
  if (scope === "chat") return input.chatId ?? null;
  return null;
}

function shouldPinByDefault(kind: MemoryKind, scope: MemoryScope): boolean {
  if (scope === "chat") return false;
  return kind === "preference" || kind === "business_rule" || kind === "metric_definition";
}

function tokenize(query: string): string[] {
  const seen = new Set<string>();
  const raw = query.toLowerCase().match(/[a-z0-9][a-z0-9_-]+/g) ?? [];
  for (const t of raw) {
    if (t.length >= 2) seen.add(t);
    if (seen.size >= 12) break;
  }
  return Array.from(seen);
}

function escapeLike(token: string): string {
  return token.replace(/[%_]/g, "");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
