"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, MessageSquare, GitBranch, History, Trash2 } from "lucide-react";
import { brand } from "@/lib/brand";
import type { ChatRow } from "@/lib/db/chats";
import type { Workflow as WorkflowDef } from "@/lib/workflow/schema";
import type { RunStatus } from "@/lib/db/runs";

interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  updated_at?: string;
  hasCron?: boolean;
  lastRunStatus?: RunStatus | null;
}

const LS_CHATS = "agent.sidebar.chats";
const LS_WORKFLOWS = "agent.sidebar.workflows";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  // Empty initial state — server and first client render match. localStorage
  // is read in the effect below to avoid a hydration mismatch.
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);

  // Hydrate from localStorage cache immediately after mount (instant render)
  // and then refresh from the server.
  useEffect(() => {
    const cachedChats = readLocal<ChatRow[]>(LS_CHATS, []);
    const cachedWorkflows = readLocal<WorkflowSummary[]>(LS_WORKFLOWS, []);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (cachedChats.length) setChats(cachedChats);
    if (cachedWorkflows.length) setWorkflows(cachedWorkflows);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [chatRes, wfRes] = await Promise.all([
        fetch("/api/chats").then((r) => r.json()),
        fetch("/api/workflows").then((r) => r.json()),
      ]);
      const cs = (chatRes.chats as ChatRow[]) ?? [];
      const ws = ((wfRes.workflows as (WorkflowDef & { hasCron?: boolean; lastRunStatus?: RunStatus | null })[]) ?? []).map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        updated_at: w.updatedAt,
        hasCron: w.hasCron,
        lastRunStatus: w.lastRunStatus ?? null,
      }));
      const visibleWorkflows = ws.filter((w) => w.name !== "Ad-hoc Analyst");
      setChats(cs);
      setWorkflows(visibleWorkflows);
      try {
        localStorage.setItem(LS_CHATS, JSON.stringify(cs));
        localStorage.setItem(LS_WORKFLOWS, JSON.stringify(visibleWorkflows));
      } catch {}
    } catch {}
  }, []);

  useEffect(() => {
    // setState inside `refresh` happens post-await, not synchronously in the
    // effect body — but the linter can't see through the indirection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [pathname, refresh]);

  // Refresh on demand when other parts of the app mutate the relevant tables.
  // The chat page dispatches `reckon:workflows-changed` after the agent's
  // create_workflow tool returns ok=true, and `reckon:chats-changed` when a
  // new chat is created or its title is set on the first turn.
  useEffect(() => {
    const onChange = () => void refresh();
    window.addEventListener("reckon:workflows-changed", onChange);
    window.addEventListener("reckon:chats-changed", onChange);
    return () => {
      window.removeEventListener("reckon:workflows-changed", onChange);
      window.removeEventListener("reckon:chats-changed", onChange);
    };
  }, [refresh]);

  // Slow background poll so cron-driven runs (which have no client-side
  // trigger to dispatch an event) eventually surface as live-now indicators,
  // and so the indicator clears once the run finishes. 5s feels live without
  // hammering — equivalent data lives in /api/workflows so the SQL is
  // already a small JOIN on the runs table.
  useEffect(() => {
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const activeChatId = pathname?.startsWith("/c/") ? pathname.slice(3) : null;
  const activeWorkflowId = pathname?.startsWith("/w/") ? pathname.slice(3) : null;
  const onHome = pathname === "/";
  const onRuns = pathname === "/runs";

  const deleteChat = useCallback(
    async (chat: ChatRow) => {
      const label = chat.title ?? "Untitled chat";
      if (!confirm(`Delete chat "${label}"? This removes its run history too.`)) return;
      const res = await fetch(`/api/chats/${chat.id}`, { method: "DELETE" });
      if (!res.ok) return;
      setChats((prev) => {
        const next = prev.filter((c) => c.id !== chat.id);
        try {
          localStorage.setItem(LS_CHATS, JSON.stringify(next));
        } catch {}
        return next;
      });
      if (activeChatId === chat.id) router.push("/");
    },
    [activeChatId, router]
  );

  const deleteWorkflow = useCallback(
    async (wf: WorkflowSummary) => {
      if (!confirm(`Delete workflow "${wf.name}"?`)) return;
      const res = await fetch(`/api/workflows/${wf.id}`, { method: "DELETE" });
      if (!res.ok) return;
      setWorkflows((prev) => {
        const next = prev.filter((w) => w.id !== wf.id);
        try {
          localStorage.setItem(LS_WORKFLOWS, JSON.stringify(next));
        } catch {}
        return next;
      });
      if (activeWorkflowId === wf.id) router.push("/");
    },
    [activeWorkflowId, router]
  );

  return (
    <aside className="sidebar-gradient hidden h-screen w-[260px] shrink-0 flex-col border-r border-line md:flex">
      <div className="flex shrink-0 items-center gap-2 px-4 py-4">
        {/* Logo inherits from `text-fg` so a single-color SVG (using
            `currentColor`) themes automatically. PNG / multi-color SVGs work
            too — they just won't pick up the text color. */}
        <span className="inline-flex h-6 w-6 items-center justify-center text-fg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.logo}
            alt={`${brand.name} logo`}
            className="h-6 w-6 object-contain"
          />
        </span>
        <div className="text-[13.5px] font-semibold tracking-tight">
          {brand.name}
        </div>
      </div>

      <div className="px-2">
        <Link
          href="/"
          className={`group flex h-8 items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors ${
            onHome
              ? "bg-fg text-bg"
              : "text-fg-1 hover:bg-bg-2"
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </Link>
      </div>

      <Section icon={<MessageSquare className="h-3 w-3" />} label="Chats" total={chats.length}>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-1">
          {chats.length === 0 ? (
            <Empty>No chats yet.</Empty>
          ) : (
            chats.map((c) => (
              <SidebarRow
                key={c.id}
                href={`/c/${c.id}`}
                active={activeChatId === c.id}
                title={c.title ?? "Untitled chat"}
                label={c.title ?? "Untitled chat"}
                onDelete={() => deleteChat(c)}
                deleteLabel="Delete chat"
              />
            ))
          )}
        </div>
      </Section>

      <Section icon={<GitBranch className="h-3 w-3" />} label="Workflows" total={workflows.length}>
        <div className="max-h-[35vh] overflow-y-auto pb-2">
          {workflows.length === 0 ? (
            <Empty>
              Tell the agent <span className="italic">save this as a workflow</span>.
            </Empty>
          ) : (
            workflows.map((w) => (
              <SidebarRow
                key={w.id}
                href={`/w/${w.id}`}
                active={activeWorkflowId === w.id}
                title={w.description}
                label={w.name}
                onDelete={() => deleteWorkflow(w)}
                deleteLabel="Delete workflow"
                trailing={<RunStatusDot status={w.lastRunStatus ?? null} />}
              />
            ))
          )}
        </div>
      </Section>

      <div className="mt-auto border-t border-line px-2 py-2">
        <Link
          href="/runs"
          className={`flex h-8 items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors ${
            onRuns ? "bg-bg-2 text-fg" : "text-fg-2 hover:bg-bg-2 hover:text-fg-1"
          }`}
        >
          <History className="h-3.5 w-3.5" />
          All runs
        </Link>
      </div>
    </aside>
  );
}

function Section({
  icon,
  label,
  total,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pb-1 pt-4">
        <div className="flex items-center gap-1.5 eyebrow text-fg-3">
          <span className="text-fg-4">{icon}</span>
          {label}
        </div>
        <span className="font-mono text-[10px] tabular text-fg-4">{total}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-4 px-2 py-1 text-[11.5px] text-fg-3">{children}</div>
  );
}

/**
 * Status dot for a workflow row in the sidebar:
 *   - amber pulsing  → a run is in flight right now
 *   - amber static   → last run paused awaiting input (cron + askUser)
 *   - green          → last run completed successfully
 *   - red            → last run errored or was aborted
 *   - grey           → workflow has never been run
 */
function RunStatusDot({ status }: { status: RunStatus | null }) {
  let cls = "bg-fg-4";
  let title = "Never run";
  if (status === "running") {
    cls = "bg-warn pulse-soft";
    title = "Running now";
  } else if (status === "needs_input") {
    cls = "bg-warn";
    title = "Paused — awaiting input";
  } else if (status === "completed") {
    cls = "bg-good";
    title = "Last run succeeded";
  } else if (status === "error" || status === "aborted") {
    cls = "bg-bad";
    title = status === "aborted" ? "Last run was stopped" : "Last run errored";
  }
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`}
      title={title}
    />
  );
}

function SidebarRow({
  href,
  active,
  title,
  label,
  onDelete,
  deleteLabel,
  trailing,
}: {
  href: string;
  active: boolean;
  title?: string;
  label: string;
  onDelete: () => void;
  deleteLabel: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className={`group relative mx-2 flex items-center gap-2 rounded-md text-[12.5px] transition-colors ${
        active ? "bg-bg-2 text-fg" : "text-fg-2 hover:bg-bg-2 hover:text-fg-1"
      }`}
    >
      <Link
        href={href}
        title={title}
        className="flex min-w-0 flex-1 items-center gap-2 truncate px-2 py-1.5"
      >
        <span className="flex-1 truncate">{label}</span>
        {trailing}
      </Link>
      <button
        type="button"
        aria-label={deleteLabel}
        title={deleteLabel}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
        className="mr-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-bg-3 hover:text-bad group-hover:flex focus-visible:flex"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
