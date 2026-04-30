"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertOctagon } from "lucide-react";
import type { RunEvent } from "@/lib/runtime/event-types";

interface Props {
  event: RunEvent;
}

export function MessageItem({ event }: Props) {
  if (event.type === "user_message") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-fg px-3.5 py-2 text-[14px] leading-relaxed text-bg">
          <div className="markdown !text-bg [&_*]:!text-bg [&_a]:!text-bg [&_a]:!underline">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.text}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }
  if (event.type === "thought") {
    return (
      <div className="markdown text-fg-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.text}</ReactMarkdown>
      </div>
    );
  }
  if (event.type === "result") {
    if (!event.text || !event.text.trim()) return null;
    const kpis = extractKpis(event.text);
    return (
      <div className="border-l-2 border-accent pl-3.5">
        {kpis.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {kpis.map((k, i) => (
              <span
                key={i}
                className="rounded-md bg-bg-2 px-2 py-0.5 font-mono text-[12px] tabular font-medium text-fg-1"
              >
                {k}
              </span>
            ))}
          </div>
        ) : null}
        <div className="markdown text-fg">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.text}</ReactMarkdown>
        </div>
      </div>
    );
  }
  if (event.type === "status") {
    return (
      <div className="text-[11.5px] text-fg-3">{event.text}</div>
    );
  }
  if (event.type === "error") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-bad-soft bg-[color:color-mix(in_oklab,var(--bad)_8%,var(--bg))] p-3 text-[13px] text-bad">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="text-[10.5px] font-medium uppercase tracking-wide opacity-75">
            Error · {event.stage}
          </div>
          <div className="mt-0.5">{event.message}</div>
        </div>
      </div>
    );
  }
  return null;
}

/** Surface big numeric findings as chips above the prose. */
function extractKpis(text: string): string[] {
  if (!text) return [];
  const head = text.slice(0, 600);
  const found = new Set<string>();
  const patterns: RegExp[] = [
    /\$[0-9][0-9.,]*/g,
    /\b[0-9]+(?:\.[0-9]+)?%/g,
    /\b[0-9]{4,}(?:\.[0-9]+)?\b/g,
  ];
  for (const re of patterns) {
    for (const m of head.matchAll(re)) {
      found.add(m[0]);
      if (found.size >= 4) return [...found];
    }
  }
  return [...found];
}
