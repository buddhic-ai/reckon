"use client";

import { use as usePromise, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ChatThread } from "@/components/ChatThread";
import { Composer } from "@/components/Composer";
import { uploadFiles, joinMessageWithAttachments } from "@/components/upload-helper";
import type { RunEvent } from "@/lib/runtime/event-types";
import type { ChatRow } from "@/lib/db/chats";

interface PageProps {
  params: Promise<{ chatId: string }>;
}

export default function ChatPage({ params }: PageProps) {
  const { chatId } = usePromise(params);
  const [chat, setChat] = useState<ChatRow | null>(null);
  // Start empty so SSR and first client render match; hydrate from
  // localStorage in an effect below.
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notFound, setNotFound] = useState(false);
  const seedFiredRef = useRef(false);

  const persistEvents = useCallback(
    (next: RunEvent[]) => {
      try {
        localStorage.setItem(`chat:${chatId}:events`, JSON.stringify(next.slice(-200)));
      } catch {}
    },
    [chatId]
  );

  const appendEvent = useCallback(
    (ev: RunEvent) => {
      setEvents((prev) => {
        const next = [...prev, ev];
        persistEvents(next);
        return next;
      });
    },
    [persistEvents]
  );

  // Hydrate from localStorage cache after mount (no SSR mismatch).
  useEffect(() => {
    const cached = readLocalEvents(chatId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.length) setEvents(cached);
  }, [chatId]);

  // Then load authoritative chat state from server and replace the cache.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/chats/${chatId}`);
      if (cancelled) return;
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = (await res.json()) as { chat: ChatRow; events: RunEvent[] };
      setChat(data.chat);
      setEvents(data.events);
      persistEvents(data.events);
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, persistEvents]);

  // Kick off SSE for a new turn — POST /api/run with chatId + message, stream
  // events back into local state.
  const startTurn = useCallback(
    async (text: string, files: File[] = []) => {
      if (busy) return;
      if (!text.trim() && files.length === 0) return;
      setBusy(true);
      try {
        const uploaded = files.length > 0 ? await uploadFiles(chatId, files) : [];
        const message = joinMessageWithAttachments(text, uploaded);
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, initialUserMessage: message }),
        });
        if (!res.ok || !res.body) {
          setBusy(false);
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data: "))
              .map((l) => l.slice(6))
              .join("\n");
            if (!data) continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed?.type === "_hello" && typeof parsed.runId === "string") {
                setRunId(parsed.runId);
                continue;
              }
              if (parsed?.type === "done") {
                setBusy(false);
                setRunId(null);
                continue;
              }
              appendEvent(parsed as RunEvent);
            } catch {
              /* ignore */
            }
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, chatId, appendEvent]
  );

  // Seed-on-mount: if home page stashed the first message, fire it now.
  useEffect(() => {
    if (seedFiredRef.current) return;
    seedFiredRef.current = true;
    let seed: string | null = null;
    try {
      seed = sessionStorage.getItem(`chat:${chatId}:seed`);
      if (seed) sessionStorage.removeItem(`chat:${chatId}:seed`);
    } catch {}
    if (seed && seed.trim()) {
      void startTurn(seed.trim(), []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const onAnswer = useCallback(
    async (questionId: string, answer: string) => {
      setAnswers((a) => ({ ...a, [questionId]: answer }));
      if (!runId) return;
      await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, questionId, answer }),
      });
    },
    [runId]
  );

  if (notFound) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm text-fg-2">
          <div className="space-y-2 text-center">
            <p>Chat not found.</p>
            <Link href="/" className="text-accent hover:underline">
              Start a new chat
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-line bg-bg/80 px-5 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href="/"
              className="rounded-md p-1 text-fg-3 hover:bg-bg-2 hover:text-fg-1"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-[14px] font-semibold tracking-tight text-fg">
                {chat?.title ?? "New chat"}
              </h1>
              <p className="truncate text-[11px] text-fg-3">Ad-hoc analyst</p>
            </div>
          </div>
          <BusyDot busy={busy} />
        </header>
        <ChatThread
          events={events}
          showTools
          pendingAnswers={answers}
          onAnswer={onAnswer}
        />
        <Composer
          onSend={startTurn}
          disabled={busy}
          placeholder={busy ? "Working…" : "Reply to the agent…"}
          draftKey={`chat:${chatId}:draft`}
        />
      </div>
    </AppShell>
  );
}

function BusyDot({ busy }: { busy: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-2">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          busy ? "bg-accent pulse-soft" : "bg-fg-4"
        }`}
      />
      {busy ? "Working" : "Idle"}
    </span>
  );
}

function readLocalEvents(chatId: string): RunEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`chat:${chatId}:events`);
    if (!raw) return [];
    return JSON.parse(raw) as RunEvent[];
  } catch {
    return [];
  }
}
