"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Sparkles, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { confirmDialog } from "@/components/ConfirmModal";

interface SkillRow {
  name: string;
  description: string;
  updatedAt: string;
  fileCount: number;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [busyName, setBusyName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/skills", { cache: "no-store" }).then((r) => r.json());
    setSkills((res.skills as SkillRow[]) ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const remove = useCallback(
    async (skill: SkillRow) => {
      const ok = await confirmDialog({
        title: `Delete skill "${skill.name}"?`,
        description: "Removes the skill folder from .claude/skills/.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      setBusyName(skill.name);
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(skill.name)}`, {
          method: "DELETE",
        });
        if (res.ok) {
          window.dispatchEvent(new Event("reckon:skills-changed"));
          await refresh();
        }
      } finally {
        setBusyName(null);
      }
    },
    [refresh]
  );

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
              <Sparkles className="h-4 w-4 text-fg-2" />
              <h1 className="text-[14px] font-semibold tracking-tight text-fg">
                Skills
              </h1>
              <span className="text-[11px] text-fg-3">{skills.length} installed</span>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {skills.length === 0 ? (
            <p className="text-sm text-fg-3">
              No skills installed. Skills appear here when the agent saves a
              reusable capability via the in-chat <em>save this as a skill</em>{" "}
              flow, or when you drop an{" "}
              <a
                href="https://agentskills.io"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                agentskills.io-format
              </a>{" "}
              skill into <code className="font-mono text-[11.5px]">.claude/skills/</code>.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {skills.map((skill) => (
                <li key={skill.name} className="py-3">
                  <SkillItem
                    skill={skill}
                    busy={busyName === skill.name}
                    onDelete={() => void remove(skill)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function SkillItem({
  skill,
  busy,
  onDelete,
}: {
  skill: SkillRow;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
          <Link
            href={`/s/${encodeURIComponent(skill.name)}`}
            className="font-mono text-[12.5px] font-medium text-fg hover:underline"
          >
            @{skill.name}
          </Link>
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {skill.fileCount} {skill.fileCount === 1 ? "file" : "files"}
          </span>
          <span>updated {new Date(skill.updatedAt).toLocaleDateString()}</span>
        </div>
        {skill.description ? (
          <p className="mt-1 text-sm text-fg-1">{skill.description}</p>
        ) : null}
      </div>
      <button
        disabled={busy}
        onClick={onDelete}
        aria-label="Delete skill"
        className="rounded p-1.5 text-fg-3 hover:bg-bg-2 hover:text-bad disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
