"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Brain, Clock, Pin, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { confirmDialog } from "@/components/ConfirmModal";

interface MemoryRow {
  id: string;
  kind: string;
  scope: string;
  scopeId: string | null;
  text: string;
  pinned: boolean;
  confidence: number;
  useCount: number;
  lastUsedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PendingRow {
  id: string;
  chatId: string | null;
  runId: string | null;
  workflowId: string | null;
  draftText: string;
  draftKind: string;
  draftScope: string;
  confidence: number;
  reasoning: string | null;
  conflicts: Array<{ memoryId: string; text: string; similarity: number }>;
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [mRes, pRes] = await Promise.all([
      fetch(
        `/api/memories${includeArchived ? "?includeArchived=true" : ""}`,
        { cache: "no-store" }
      ).then((r) => r.json()),
      fetch("/api/memories/pending", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setMemories((mRes.memories as MemoryRow[]) ?? []);
    setPending((pRes.pending as PendingRow[]) ?? []);
  }, [includeArchived]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const archive = useCallback(
    async (id: string) => {
      const ok = await confirmDialog({
        title: "Archive this memory?",
        description: "It stops being injected into future runs but stays in the audit log.",
        confirmLabel: "Archive",
        destructive: true,
      });
      if (!ok) return;
      setBusyId(id);
      try {
        const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "manual archive from /m" }),
        });
        if (res.ok) await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  const decide = useCallback(
    async (
      id: string,
      action: "accept" | "decline",
      overrides?: { scope?: string; scopeId?: string | null }
    ) => {
      setBusyId(id);
      try {
        const res = await fetch("/api/memories/decide", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, action, ...overrides }),
        });
        if (res.ok) await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  const active = memories.filter((m) => !m.archivedAt);
  const archived = memories.filter((m) => m.archivedAt);

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-line bg-bg/80 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-md p-1 text-fg-3 hover:bg-bg-2 hover:text-fg-1"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-fg-2" />
              <h1 className="text-[14px] font-semibold tracking-tight text-fg">
                Memory
              </h1>
              <span className="text-[11px] text-fg-3">
                {active.length} active · {pending.length} pending
              </span>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-fg-2">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Show archived
          </label>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {pending.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-fg-3">
                Pending review ({pending.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {pending.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                  >
                    <div className="font-medium">
                      {p.draftKind.replace(/_/g, " ")} ·{" "}
                      {p.chatId ? "chat/global" : "global"} · ~{Math.round(p.confidence * 100)}%
                    </div>
                    <div className="italic text-amber-900">&ldquo;{p.draftText}&rdquo;</div>
                    {p.reasoning && (
                      <div className="mt-1 text-xs text-amber-700">
                        {p.reasoning}
                      </div>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={busyId === p.id}
                        onClick={() =>
                          void decide(p.id, "accept", {
                            scope: "global",
                          })
                        }
                        className="rounded bg-amber-700 px-2 py-1 text-xs font-medium text-white hover:bg-amber-800"
                      >
                        Save globally
                      </button>
                      {p.chatId ? (
                        <button
                          disabled={busyId === p.id}
                          onClick={() =>
                            void decide(p.id, "accept", {
                              scope: "chat",
                              scopeId: p.chatId,
                            })
                          }
                          className="rounded border border-amber-400 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                        >
                          Save for this chat only
                        </button>
                      ) : null}
                      <button
                        disabled={busyId === p.id}
                        onClick={() => void decide(p.id, "decline")}
                        className="rounded border border-amber-400 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                      >
                        Decline
                      </button>
                      {p.chatId ? (
                        <Link
                          href={`/c/${p.chatId}`}
                          className="ml-auto self-center text-xs text-amber-800 hover:underline"
                        >
                          See chat →
                        </Link>
                      ) : p.runId ? (
                        <Link
                          href={`/r/${p.runId}`}
                          className="ml-auto self-center text-xs text-amber-800 hover:underline"
                        >
                          See run →
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-fg-3">
              Saved memories ({active.length})
            </h2>
            {active.length === 0 ? (
              <p className="text-sm text-fg-3">
                Nothing saved yet. Memories appear here when the operator
                tells the agent &quot;remember that&hellip;&quot; or when the
                auto-memory classifier promotes a turn into a stable rule.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {active.map((m) => (
                  <li key={m.id} className="py-3">
                    <MemoryItem
                      memory={m}
                      busy={busyId === m.id}
                      onArchive={() => void archive(m.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {includeArchived && archived.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-fg-3">
                Archived ({archived.length})
              </h2>
              <ul className="flex flex-col divide-y divide-line">
                {archived.map((m) => (
                  <li key={m.id} className="py-3 opacity-60">
                    <MemoryItem memory={m} busy={false} archived />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function MemoryItem({
  memory,
  busy,
  onArchive,
  archived = false,
}: {
  memory: MemoryRow;
  busy: boolean;
  onArchive?: () => void;
  archived?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
          <span className="rounded bg-bg-2 px-1.5 py-0.5 text-fg-2">
            {memory.kind.replace(/_/g, " ")}
          </span>
          <span>
            {memory.scope}
            {memory.scopeId ? `:${memory.scopeId.slice(0, 8)}` : ""}
          </span>
          {memory.pinned && (
            <span className="inline-flex items-center gap-1 text-fg-2">
              <Pin className="h-3 w-3" /> pinned
            </span>
          )}
          {memory.useCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> used {memory.useCount}×
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-fg-1">{memory.text}</p>
        <p className="mt-0.5 text-[11px] text-fg-4">
          created {new Date(memory.createdAt).toLocaleDateString()}
          {memory.lastUsedAt && (
            <> · last used {new Date(memory.lastUsedAt).toLocaleDateString()}</>
          )}
        </p>
      </div>
      {!archived && onArchive && (
        <button
          disabled={busy}
          onClick={onArchive}
          aria-label="Archive memory"
          className="rounded p-1.5 text-fg-3 hover:bg-bg-2 hover:text-bad disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
