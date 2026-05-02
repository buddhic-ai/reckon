"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Check, X, Pencil } from "lucide-react";

interface PendingConflict {
  memoryId: string;
  text: string;
  similarity: number;
}

interface PendingMemory {
  id: string;
  chatId: string | null;
  runId: string | null;
  workflowId: string | null;
  draftText: string;
  draftKind: string;
  draftScope: string;
  draftScopeId: string | null;
  confidence: number;
  reasoning: string | null;
  conflicts: PendingConflict[];
}

type Surface = { kind: "chat"; chatId: string } | { kind: "run"; runId: string };

interface PendingMemoryBannerProps {
  surface: Surface;
}

/**
 * Renders unresolved auto-memory proposals attached to the current chat or
 * workflow run. The operator picks an option per proposal and the banner
 * disappears the moment every pending row is resolved.
 *
 * Refreshes when the run finishes (`reckon:run-complete` event) so a
 * just-classified turn surfaces without a manual reload.
 */
export function PendingMemoryBanner({ surface }: PendingMemoryBannerProps) {
  const [pending, setPending] = useState<PendingMemory[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>("");

  const fetchUrl =
    surface.kind === "chat"
      ? `/api/memories/pending?chatId=${encodeURIComponent(surface.chatId)}`
      : `/api/memories/pending?runId=${encodeURIComponent(surface.runId)}`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(fetchUrl, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { pending: PendingMemory[] };
      setPending(data.pending ?? []);
    } catch {
      // best-effort; banner will retry on next event
    }
  }, [fetchUrl]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const onRunComplete = () => void refresh();
    const onMemoryDecision = () => void refresh();
    window.addEventListener("reckon:run-complete", onRunComplete);
    window.addEventListener("reckon:memory-decision", onMemoryDecision);
    return () => {
      window.removeEventListener("reckon:run-complete", onRunComplete);
      window.removeEventListener("reckon:memory-decision", onMemoryDecision);
    };
  }, [refresh]);

  const decide = useCallback(
    async (
      id: string,
      action: "accept" | "decline",
      overrides?: { text?: string; scope?: string; scopeId?: string | null }
    ) => {
      setBusyId(id);
      try {
        const body: Record<string, unknown> = { id, action };
        if (overrides?.text) body.text = overrides.text;
        if (overrides?.scope) body.scope = overrides.scope;
        if (overrides?.scopeId !== undefined) body.scopeId = overrides.scopeId;
        const res = await fetch("/api/memories/decide", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) return;
        setEditingId(null);
        setEditText("");
        await refresh();
        window.dispatchEvent(new Event("reckon:memory-decision"));
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  if (pending.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      {pending.map((p) => {
        const editing = editingId === p.id;
        const text = editing ? editText : p.draftText;
        const confidencePct = Math.round(p.confidence * 100);
        const scopeId =
          p.draftScope === "workflow"
            ? p.workflowId
            : p.draftScope === "chat"
            ? p.chatId
            : p.draftScopeId;
        return (
          <div
            key={p.id}
            className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          >
            <div className="flex items-start gap-2">
              <Brain className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              <div className="flex-1">
                <div className="font-medium">
                  Want me to remember this?
                  <span className="ml-2 font-normal text-amber-700">
                    {p.draftKind.replace(/_/g, " ")} ·{" "}
                    {p.draftScope === "workflow"
                      ? "this workflow"
                      : p.draftScope === "chat"
                      ? "this chat"
                      : "global"}{" "}
                    · ~{confidencePct}% confidence
                  </span>
                </div>
                {editing ? (
                  <textarea
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="mt-1 w-full rounded border border-amber-300 bg-white px-2 py-1 text-sm text-amber-950"
                    rows={2}
                  />
                ) : (
                  <div className="mt-1 italic text-amber-900">&ldquo;{text}&rdquo;</div>
                )}
                {p.reasoning && !editing && (
                  <div className="mt-1 text-xs text-amber-700">{p.reasoning}</div>
                )}
                {p.conflicts.length > 0 && !editing && (
                  <div className="mt-1 rounded border border-amber-200 bg-amber-100/70 px-2 py-1 text-xs">
                    Conflicts with {p.conflicts.length} existing{" "}
                    {p.conflicts.length === 1 ? "memory" : "memories"}:{" "}
                    <span className="italic">&ldquo;{p.conflicts[0].text}&rdquo;</span>
                    {p.conflicts.length > 1 && ` (+${p.conflicts.length - 1} more)`}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {editing ? (
                    <>
                      <button
                        disabled={busyId === p.id || editText.trim().length < 4}
                        onClick={() => void decide(p.id, "accept", { text: editText })}
                        className="inline-flex items-center gap-1 rounded bg-amber-700 px-2 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" aria-hidden /> Save edited
                      </button>
                      <button
                        disabled={busyId === p.id}
                        onClick={() => {
                          setEditingId(null);
                          setEditText("");
                        }}
                        className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                      >
                        Cancel edit
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        disabled={busyId === p.id}
                        onClick={() => void decide(p.id, "accept")}
                        className="inline-flex items-center gap-1 rounded bg-amber-700 px-2 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" aria-hidden /> Yes, save{" "}
                        {p.draftScope === "workflow"
                          ? "for this workflow"
                          : p.draftScope === "chat"
                          ? "for this chat"
                          : "globally"}
                      </button>
                      {p.draftScope !== "workflow" && p.workflowId && (
                        <button
                          disabled={busyId === p.id}
                          onClick={() =>
                            void decide(p.id, "accept", {
                              scope: "workflow",
                              scopeId: p.workflowId ?? undefined,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                        >
                          Save for this workflow only
                        </button>
                      )}
                      <button
                        disabled={busyId === p.id}
                        onClick={() => {
                          setEditingId(p.id);
                          setEditText(p.draftText);
                        }}
                        className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                      >
                        <Pencil className="h-3 w-3" aria-hidden /> Edit first
                      </button>
                      <button
                        disabled={busyId === p.id}
                        onClick={() => void decide(p.id, "decline")}
                        className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                      >
                        <X className="h-3 w-3" aria-hidden /> No, that was a one-off
                      </button>
                    </>
                  )}
                </div>
                {scopeId && p.draftScope !== "global" && !editing && (
                  <div className="mt-1 text-[11px] text-amber-700">
                    scope id: <code>{scopeId}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
