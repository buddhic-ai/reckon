CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  json        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_updated ON workflows(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_workflows_name ON workflows(name);

CREATE TABLE IF NOT EXISTS chats (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  workflow_id    TEXT,
  chat_id        TEXT,
  kind           TEXT NOT NULL,
  trigger        TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  status         TEXT NOT NULL,
  total_tokens   INTEGER,
  total_cost_usd REAL,
  error_message  TEXT,
  result_summary TEXT,
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_chat ON runs(chat_id, started_at ASC);

CREATE TABLE IF NOT EXISTS run_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL,
  ts           TEXT NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, id);

-- Cached home-screen suggestion chips. One row per knowledge-pack fingerprint
-- so the chips automatically regenerate when the connected DB schema changes.
CREATE TABLE IF NOT EXISTS home_suggestions (
  fingerprint  TEXT PRIMARY KEY,
  json         TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
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
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id   TEXT,
  run_id      TEXT,
  chat_id     TEXT,
  action      TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);
CREATE INDEX IF NOT EXISTS idx_memory_events_memory ON memory_events(memory_id, id DESC);
