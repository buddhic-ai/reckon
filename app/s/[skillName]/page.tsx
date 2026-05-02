"use client";

import { use as usePromise, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { confirmDialog } from "@/components/ConfirmModal";
import type { SkillDetail } from "@/lib/skills/schema";

interface PageProps {
  params: Promise<{ skillName: string }>;
}

export default function SkillDetailPage({ params }: PageProps) {
  const router = useRouter();
  const { skillName } = usePromise(params);
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}`);
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    const data = (await res.json()) as { skill: SkillDetail };
    setSkill(data.skill);
  }, [skillName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const remove = useCallback(async () => {
    if (!skill) return;
    const ok = await confirmDialog({
      title: `Delete skill "${skill.name}"?`,
      description: "Removes the skill folder from .claude/skills/.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/skills/${encodeURIComponent(skill.name)}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    window.dispatchEvent(new Event("reckon:skills-changed"));
    router.push("/");
  }, [skill, router]);

  if (notFound) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm text-fg-2">
          <div className="space-y-2 text-center">
            <p>Skill not found.</p>
            <Link href="/" className="text-accent hover:underline">
              Back to home
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!skill) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm text-fg-3">
          Loading...
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-line bg-bg/80 px-5 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/" className="rounded-md p-1 text-fg-3 hover:bg-bg-2 hover:text-fg-1">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-[14px] font-semibold tracking-tight text-fg">
                {skill.name}
              </h1>
              <p className="truncate text-[11.5px] text-fg-3">{skill.description}</p>
            </div>
          </div>
          <button
            onClick={remove}
            className="rounded-md p-1.5 text-fg-3 transition-colors hover:bg-bg-2 hover:text-bad"
            title="Delete skill"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            <section>
              <h2 className="eyebrow mb-2">Location</h2>
              <div className="rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px] text-fg-2">
                {skill.path}
              </div>
            </section>

            <section>
              <h2 className="eyebrow mb-2">Files</h2>
              <div className="overflow-hidden rounded-md border border-line bg-bg">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {skill.files.map((file) => (
                      <tr key={file.path} className="border-t border-line first:border-t-0">
                        <td className="flex items-center gap-2 px-3 py-1.5 text-fg-1">
                          <FileText className="h-3 w-3 text-fg-4" />
                          <span className="font-mono">{file.path}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular text-fg-3">
                          {file.bytes.toLocaleString()} B
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="eyebrow mb-2">SKILL.md</h2>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-line bg-bg px-4 py-3 text-[12px] leading-5 text-fg-1">
                {skill.skillMarkdown}
              </pre>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
