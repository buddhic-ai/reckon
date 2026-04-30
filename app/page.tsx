"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BarChart3, Database, FileText, GitBranch } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Composer } from "@/components/Composer";
import { uploadFiles, joinMessageWithAttachments } from "@/components/upload-helper";

const SUGGESTIONS: { icon: React.ReactNode; label: string; prompt: string }[] = [
  {
    icon: <BarChart3 className="h-3.5 w-3.5" />,
    label: "Top performers",
    prompt: "Who are our top 5 salespeople by year-to-date revenue, and what territories do they cover?",
  },
  {
    icon: <Database className="h-3.5 w-3.5" />,
    label: "Inspect an order",
    prompt: "Show me order 43659 with all its line items and totals.",
  },
  {
    icon: <BarChart3 className="h-3.5 w-3.5" />,
    label: "Regional split",
    prompt: "Break down our total sales by territory group — what share comes from each region?",
  },
  {
    icon: <FileText className="h-3.5 w-3.5" />,
    label: "Bestsellers",
    prompt: "Which 5 products had the most units sold last year? Show units and revenue side by side.",
  },
];

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function startChat(text: string, files: File[] = []) {
    if (busy) return;
    if (!text.trim() && files.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chats", { method: "POST" });
      if (!res.ok) {
        setBusy(false);
        return;
      }
      const { chat } = (await res.json()) as { chat: { id: string } };
      const uploaded = files.length > 0 ? await uploadFiles(chat.id, files) : [];
      const seed = joinMessageWithAttachments(text, uploaded);
      try {
        sessionStorage.setItem(`chat:${chat.id}:seed`, seed);
      } catch {}
      router.push(`/c/${chat.id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12">
          <div className="w-full max-w-2xl fade-in-up">
            <div className="mb-8">
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-fg">
                What do you want to know?
              </h1>
              <p className="mt-1.5 text-[14px] text-fg-2">
                Ask a question, attach a file, or describe a recurring task to save as a workflow.
              </p>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.prompt}
                  onClick={() => void startChat(s.prompt, [])}
                  disabled={busy}
                  className="group flex items-start gap-2.5 rounded-md border border-line bg-bg px-3 py-2.5 text-left transition-all hover:border-line-strong hover:bg-bg-1 disabled:opacity-50"
                >
                  <span className="mt-0.5 shrink-0 text-fg-3 transition-colors group-hover:text-accent">
                    {s.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-fg">{s.label}</span>
                    <span className="block truncate text-[11.5px] text-fg-3">
                      {s.prompt}
                    </span>
                  </span>
                  <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-fg-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-fg-3">
              <GitBranch className="h-3 w-3" />
              <span>
                Saved workflows live in the sidebar. Tell the agent <span className="italic">save this as a workflow</span> to add one.
              </span>
            </div>
          </div>
        </div>

        <div className="shrink-0">
          <Composer
            onSend={startChat}
            disabled={busy}
            placeholder="Ask a question, attach a file, or describe a recurring task…"
            draftKey="agent.draft.home"
          />
        </div>
      </div>
    </AppShell>
  );
}
