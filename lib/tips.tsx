import type { ReactNode } from "react";

export type Tip = {
  id: string;
  category: string;
  title: string;
  body: ReactNode;
};

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex min-w-[1.4em] items-center justify-center rounded border border-line-strong bg-bg px-1.5 py-px font-mono text-[11px] leading-tight text-accent-deep tabular-nums">
      {children}
    </span>
  );
}

export const TIPS: Tip[] = [
  {
    id: "mention-skill",
    category: "Composer",
    title: "Mention a skill",
    body: (
      <>
        Type <Kbd>@</Kbd> in the composer to surface a picker. Filter by name,{" "}
        <Kbd>↑</Kbd> <Kbd>↓</Kbd> to navigate, <Kbd>⏎</Kbd> to insert.
      </>
    ),
  },
  {
    id: "shift-enter",
    category: "Composer",
    title: "Newline without sending",
    body: (
      <>
        <Kbd>⏎</Kbd> sends the message. <Kbd>⇧⏎</Kbd> drops a newline —
        multi-paragraph prompts welcome.
      </>
    ),
  },
  {
    id: "edit-past",
    category: "Transcript",
    title: "Rewind from any of your messages",
    body: (
      <>
        Hover one of your past messages and click the pencil. Editing wipes
        everything that came after and starts the agent fresh from there.
      </>
    ),
  },
  {
    id: "save-as-workflow",
    category: "Workflows",
    title: "Save a chat as a workflow",
    body: (
      <>
        Mid-conversation, just say <em>save this as a workflow</em>. The agent
        captures the steps so you can re-run or schedule it.
      </>
    ),
  },
  {
    id: "memory-scope",
    category: "Memory",
    title: "Memories have a scope",
    body: (
      <>
        When the yellow banner proposes a memory, save it{" "}
        <span className="italic">global</span>,{" "}
        <span className="italic">this chat</span>, or{" "}
        <span className="italic">this workflow</span> only. Default is global;
        narrow it when the fact is local.
      </>
    ),
  },
  {
    id: "run-now-cron",
    category: "Workflows",
    title: "Run now, or on a schedule",
    body: (
      <>
        Open any workflow and hit <span className="italic">Run now</span>. The
        same page has a schedule field — set it and the workflow runs on its
        own in the background. If it needs a question answered to finish, it
        pauses and waits for you under <span className="italic">Runs</span>.
      </>
    ),
  },
  {
    id: "drafts-persist",
    category: "Composer",
    title: "Drafts survive a refresh",
    body: (
      <>
        What you type stays per-chat in <Kbd>localStorage</Kbd> and reappears
        when you come back. Sending clears it.
      </>
    ),
  },
];
