"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, MessageSquare, GitBranch, History } from "lucide-react";
import { brand } from "@/lib/brand";
import type { ChatRow } from "@/lib/db/chats";
import type { Workflow as WorkflowDef } from "@/lib/workflow/schema";

interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  updated_at?: string;
  hasCron?: boolean;
}

const LS_CHATS = "agent.sidebar.chats";
const LS_WORKFLOWS = "agent.sidebar.workflows";

export function Sidebar() {
  const pathname = usePathname();
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [chatRes, wfRes] = await Promise.all([
          fetch("/api/chats").then((r) => r.json()),
          fetch("/api/workflows").then((r) => r.json()),
        ]);
        if (cancelled) return;
        const cs = (chatRes.chats as ChatRow[]) ?? [];
        const ws = ((wfRes.workflows as (WorkflowDef & { hasCron?: boolean })[]) ?? []).map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          updated_at: w.updatedAt,
          hasCron: w.hasCron,
        }));
        const visibleWorkflows = ws.filter((w) => w.name !== "Ad-hoc Analyst");
        setChats(cs);
        setWorkflows(visibleWorkflows);
        try {
          localStorage.setItem(LS_CHATS, JSON.stringify(cs));
          localStorage.setItem(LS_WORKFLOWS, JSON.stringify(visibleWorkflows));
        } catch {}
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const activeChatId = pathname?.startsWith("/c/") ? pathname.slice(3) : null;
  const activeWorkflowId = pathname?.startsWith("/w/") ? pathname.slice(3) : null;
  const onHome = pathname === "/";
  const onRuns = pathname === "/runs";

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
              <Link
                key={c.id}
                href={`/c/${c.id}`}
                className={`mx-2 truncate rounded-md px-2 py-1.5 text-[12.5px] transition-colors ${
                  activeChatId === c.id
                    ? "bg-bg-2 text-fg"
                    : "text-fg-2 hover:bg-bg-2 hover:text-fg-1"
                }`}
                title={c.title ?? "Untitled chat"}
              >
                {c.title ?? "Untitled chat"}
              </Link>
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
              <Link
                key={w.id}
                href={`/w/${w.id}`}
                className={`group mx-2 flex items-center gap-2 truncate rounded-md px-2 py-1.5 text-[12.5px] transition-colors ${
                  activeWorkflowId === w.id
                    ? "bg-bg-2 text-fg"
                    : "text-fg-2 hover:bg-bg-2 hover:text-fg-1"
                }`}
                title={w.description}
              >
                <span className="flex-1 truncate">{w.name}</span>
                {w.hasCron ? (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    title="Scheduled"
                  />
                ) : null}
              </Link>
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
