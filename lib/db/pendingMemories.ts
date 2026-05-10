import { ulid } from "ulid";
import { getDb } from "./client";
import {
  MEMORY_KINDS,
  MEMORY_SCOPES,
  normalizeNewMemoryScope,
  rememberMemory,
  type MemoryKind,
  type MemoryScope,
  type Memory,
} from "./memories";

export const PENDING_MEMORY_STATUSES = [
  "proposed",
  "accepted",
  "declined",
] as const;
export type PendingMemoryStatus = (typeof PENDING_MEMORY_STATUSES)[number];

export interface PendingMemoryConflict {
  memoryId: string;
  text: string;
  similarity: number;
}

export interface PendingMemoryRow {
  id: string;
  chat_id: string | null;
  run_id: string | null;
  workflow_id: string | null;
  status: PendingMemoryStatus;
  draft_text: string;
  draft_kind: MemoryKind;
  draft_scope: MemoryScope;
  draft_scope_id: string | null;
  confidence: number;
  reasoning: string | null;
  conflict_json: string | null;
  decision_text: string | null;
  decided_at: string | null;
  memory_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingMemory {
  id: string;
  chatId: string | null;
  runId: string | null;
  workflowId: string | null;
  status: PendingMemoryStatus;
  draftText: string;
  draftKind: MemoryKind;
  draftScope: MemoryScope;
  draftScopeId: string | null;
  confidence: number;
  reasoning: string | null;
  conflicts: PendingMemoryConflict[];
  decisionText: string | null;
  decidedAt: string | null;
  memoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePendingInput {
  chatId?: string | null;
  runId?: string | null;
  workflowId?: string | null;
  draftText: string;
  draftKind: MemoryKind;
  draftScope: MemoryScope;
  draftScopeId?: string | null;
  confidence: number;
  reasoning?: string | null;
  conflicts?: PendingMemoryConflict[];
}

export function createPendingMemory(input: CreatePendingInput): PendingMemory {
  if (!MEMORY_KINDS.includes(input.draftKind)) {
    throw new Error(`Invalid draft kind: ${input.draftKind}`);
  }
  if (!MEMORY_SCOPES.includes(input.draftScope)) {
    throw new Error(`Invalid draft scope: ${input.draftScope}`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();
  const draftScope = normalizeNewMemoryScope(input.draftScope, {
    chatId: input.chatId ?? null,
  });
  const draftScopeId =
    draftScope === "chat" ? (input.chatId ?? input.draftScopeId ?? null) : null;
  db.prepare(
    `INSERT INTO pending_memories (
       id, chat_id, run_id, workflow_id, status, draft_text, draft_kind,
       draft_scope, draft_scope_id, confidence, reasoning, conflict_json,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.chatId ?? null,
    input.runId ?? null,
    input.workflowId ?? null,
    input.draftText.trim(),
    input.draftKind,
    draftScope,
    draftScopeId,
    clamp(input.confidence, 0, 1),
    input.reasoning ?? null,
    input.conflicts && input.conflicts.length > 0
      ? JSON.stringify(input.conflicts)
      : null,
    now,
    now
  );
  return getPendingMemory(id)!;
}

export function getPendingMemory(id: string): PendingMemory | null {
  const row = getDb()
    .prepare("SELECT * FROM pending_memories WHERE id = ?")
    .get(id) as PendingMemoryRow | undefined;
  return row ? rowToPending(row) : null;
}

export function listPendingForChat(chatId: string): PendingMemory[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM pending_memories
       WHERE chat_id = ? AND status = 'proposed'
       ORDER BY created_at ASC`
    )
    .all(chatId) as PendingMemoryRow[];
  return rows.map(rowToPending);
}

export function listPendingForRun(runId: string): PendingMemory[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM pending_memories
       WHERE run_id = ? AND status = 'proposed'
       ORDER BY created_at ASC`
    )
    .all(runId) as PendingMemoryRow[];
  return rows.map(rowToPending);
}

export function listPendingForWorkflow(workflowId: string): PendingMemory[] {
  // Only proposals from workflow runs without an attached chat — chat-driven
  // proposals belong to the chat surface, not the workflow page.
  const rows = getDb()
    .prepare(
      `SELECT * FROM pending_memories
       WHERE workflow_id = ? AND chat_id IS NULL AND status = 'proposed'
       ORDER BY created_at ASC`
    )
    .all(workflowId) as PendingMemoryRow[];
  return rows.map(rowToPending);
}

export function listAllPending(
  options: { status?: PendingMemoryStatus; limit?: number } = {}
): PendingMemory[] {
  const status = options.status ?? "proposed";
  const limit = options.limit ?? 200;
  const rows = getDb()
    .prepare(
      `SELECT * FROM pending_memories
       WHERE status = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(status, limit) as PendingMemoryRow[];
  return rows.map(rowToPending);
}

export interface AcceptPendingInput {
  id: string;
  /** Optional override text — when the operator edits the draft before saving. */
  text?: string;
  /** Optional override scope — defaults to the draft's scope. */
  scope?: MemoryScope;
  scopeId?: string | null;
  /** Optional override pinned flag. */
  pinned?: boolean;
}

export function acceptPendingMemory(
  input: AcceptPendingInput
): { pending: PendingMemory; memory: Memory } {
  const db = getDb();
  const pending = getPendingMemory(input.id);
  if (!pending) throw new Error(`Pending memory not found: ${input.id}`);
  if (pending.status !== "proposed") {
    throw new Error(`Pending memory ${input.id} already ${pending.status}`);
  }

  const memory = rememberMemory({
    text: input.text?.trim() || pending.draftText,
    kind: pending.draftKind,
    scope: input.scope ?? pending.draftScope,
    scopeId: input.scopeId ?? pending.draftScopeId,
    pinned: input.pinned,
    confidence: pending.confidence,
    workflowId: pending.workflowId ?? undefined,
    chatId: pending.chatId ?? undefined,
    runId: pending.runId ?? undefined,
    metadata: {
      origin: "auto_memory_accepted",
      pendingId: pending.id,
    },
  });

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE pending_memories
     SET status = 'accepted', decision_text = ?, decided_at = ?,
         memory_id = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.text?.trim() ?? null,
    now,
    memory.id,
    now,
    input.id
  );

  return { pending: getPendingMemory(input.id)!, memory };
}

export function declinePendingMemory(id: string, reason?: string): PendingMemory {
  const db = getDb();
  const pending = getPendingMemory(id);
  if (!pending) throw new Error(`Pending memory not found: ${id}`);
  if (pending.status !== "proposed") {
    throw new Error(`Pending memory ${id} already ${pending.status}`);
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE pending_memories
     SET status = 'declined', decision_text = ?, decided_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(reason ?? null, now, now, id);
  return getPendingMemory(id)!;
}

function rowToPending(row: PendingMemoryRow): PendingMemory {
  let conflicts: PendingMemoryConflict[] = [];
  if (row.conflict_json) {
    try {
      const parsed = JSON.parse(row.conflict_json);
      if (Array.isArray(parsed)) {
        conflicts = parsed as PendingMemoryConflict[];
      }
    } catch {
      conflicts = [];
    }
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    runId: row.run_id,
    workflowId: row.workflow_id,
    status: row.status,
    draftText: row.draft_text,
    draftKind: row.draft_kind,
    draftScope: row.draft_scope,
    draftScopeId: row.draft_scope_id,
    confidence: row.confidence,
    reasoning: row.reasoning,
    conflicts,
    decisionText: row.decision_text,
    decidedAt: row.decided_at,
    memoryId: row.memory_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
