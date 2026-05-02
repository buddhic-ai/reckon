"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Clock,
  Database,
  FileText,
  GitBranch,
  TrendingUp,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Composer, type ComposerHandle } from "@/components/Composer";
import { uploadFiles, joinMessageWithAttachments } from "@/components/upload-helper";
import type { ChipIcon, Suggestion } from "@/lib/home/types";

const ICONS: Record<ChipIcon, React.ComponentType<{ className?: string }>> = {
  chart: BarChart3,
  database: Database,
  file: FileText,
  users: Users,
  trending: TrendingUp,
  clock: Clock,
};

interface Props {
  suggestions: Suggestion[];
}

export function HomeClient({ suggestions }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const composerRef = useRef<ComposerHandle | null>(null);

  function pickSuggestion(prompt: string) {
    composerRef.current?.setText(prompt);
  }

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
                Ask a question, attach a file, save a workflow, or teach the agent a reusable skill.
              </p>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {suggestions.map((s) => {
                const Icon = ICONS[s.icon] ?? FileText;
                return (
                  <button
                    key={s.prompt}
                    onClick={() => pickSuggestion(s.prompt)}
                    disabled={busy}
                    className="group flex items-start gap-2.5 rounded-md border border-line bg-bg px-3 py-2.5 text-left transition-all hover:border-line-strong hover:bg-bg-1 disabled:opacity-50"
                    title="Click to load this question into the composer"
                  >
                    <span className="mt-0.5 shrink-0 text-fg-3 transition-colors group-hover:text-accent">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-fg">{s.label}</span>
                      <span className="block truncate text-[11.5px] text-fg-3">{s.prompt}</span>
                    </span>
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-fg-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-fg-3">
              <GitBranch className="h-3 w-3" />
              <span>
                Saved workflows and skills live in the sidebar. Tell the agent <span className="italic">save this as a skill</span> to add one.
              </span>
            </div>
          </div>
        </div>

        <div className="shrink-0">
          <Composer
            ref={composerRef}
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
