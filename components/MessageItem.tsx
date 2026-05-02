"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertOctagon, Check, Copy, Pencil, RefreshCw } from "lucide-react";
import type { RunEvent } from "@/lib/runtime/event-types";

const FILE_PATH_RE = /data\/(?:reports|uploads)\/[A-Za-z0-9._\-/]+\.[A-Za-z0-9]+/g;

// Remark plugin: turn bare data/reports/... and data/uploads/... mentions in
// assistant prose into links to /api/files/<path>. This is a render-time
// display transform (analogous to URL autolinking), not logic extraction —
// no behavior is driven by what we match. Skips text inside code/link nodes
// so existing markdown links and code blocks pass through untouched.
function autolinkFilePaths() {
  return (tree: unknown) => walkNode(tree, null);
}

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

function walkNode(node: unknown, parent: MdNode | null): void {
  if (!node || typeof node !== "object") return;
  const n = node as MdNode;
  if (n.type === "code" || n.type === "inlineCode" || n.type === "link") return;
  if (n.type === "text" && typeof n.value === "string" && parent?.children) {
    const value = n.value;
    FILE_PATH_RE.lastIndex = 0;
    const matches = [...value.matchAll(FILE_PATH_RE)];
    if (matches.length === 0) return;
    const replacement: MdNode[] = [];
    let cursor = 0;
    for (const m of matches) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (start > cursor) {
        replacement.push({ type: "text", value: value.slice(cursor, start) });
      }
      replacement.push({
        type: "link",
        url: `/api/files/${m[0]}`,
        children: [{ type: "text", value: m[0] }],
      });
      cursor = end;
    }
    if (cursor < value.length) {
      replacement.push({ type: "text", value: value.slice(cursor) });
    }
    const idx = parent.children.indexOf(n);
    if (idx !== -1) parent.children.splice(idx, 1, ...replacement);
    return;
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children.slice()) walkNode(child, n);
  }
}

const REMARK_PLUGINS = [remarkGfm, autolinkFilePaths];

// File links (uploads + agent-generated downloads under /api/files/...)
// must never navigate the current tab — that would replace the chat thread.
// Try a new tab first; if a popup blocker intercepts (window.open returns
// null), fall back to a programmatic <a download> click. preventDefault
// guarantees no current-tab navigation in any code path. Modifier-key /
// middle clicks pass through so users keep "open in new tab" muscle memory.
function openFileLink(href: string) {
  const w = window.open(href, "_blank", "noopener,noreferrer");
  if (w) return;
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

const MARKDOWN_COMPONENTS = {
  a({
    href,
    children,
    onClick,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) {
    const isFile = typeof href === "string" && href.startsWith("/api/files/");
    if (isFile) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            onClick?.(e);
            if (e.defaultPrevented) return;
            // Let the browser handle Cmd/Ctrl/Shift/Alt-click and middle-
            // click natively (open-in-new-tab muscle memory).
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            if (typeof href === "string") openFileLink(href);
          }}
          {...props}
        >
          {children}
        </a>
      );
    }
    return (
      <a href={href} onClick={onClick} {...props}>
        {children}
      </a>
    );
  },
} as const;

interface Props {
  event: RunEvent;
  /** Index of this event in the chat thread's full event list. Required for
   *  retry/edit to identify the truncation point. */
  eventIndex?: number;
  /** Triggered when the user clicks "retry" on their own message. The handler
   *  is responsible for truncating server state and re-running. */
  onRetry?: (eventIndex: number, text: string) => void;
  /** Triggered when the user finishes editing a past user message. Wipes all
   *  history at and after this index, clears the SDK session, and restarts
   *  the ad-hoc analyst with the new text + only past user messages as
   *  context. */
  onEdit?: (eventIndex: number, text: string) => void;
  /** When true, copy/edit/retry icons fade in on hover under user messages. */
  showActions?: boolean;
}

export function MessageItem({
  event,
  eventIndex,
  onRetry,
  onEdit,
  showActions,
}: Props) {
  if (event.type === "user_message") {
    return (
      <UserMessage
        text={event.text}
        eventIndex={eventIndex}
        onRetry={onRetry}
        onEdit={onEdit}
        showActions={showActions}
      />
    );
  }
  if (event.type === "thought") {
    return (
      <div className="markdown text-fg-1">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{event.text}</ReactMarkdown>
      </div>
    );
  }
  if (event.type === "result") {
    if (!event.text || !event.text.trim()) return null;
    return (
      <div className="flex justify-start">
        <div className="max-w-[88%] rounded-2xl rounded-bl-sm bg-bg-1 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="markdown text-fg">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{event.text}</ReactMarkdown>
          </div>
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

function UserMessage({
  text,
  eventIndex,
  onRetry,
  onEdit,
  showActions,
}: {
  text: string;
  eventIndex?: number;
  onRetry?: (eventIndex: number, text: string) => void;
  onEdit?: (eventIndex: number, text: string) => void;
  showActions?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autoSize(el);
  }, [editing]);

  if (editing) {
    const submit = () => {
      const next = draft.trim();
      if (!next || !onEdit || eventIndex == null) {
        setEditing(false);
        setDraft(text);
        return;
      }
      setEditing(false);
      onEdit(eventIndex, next);
    };
    const cancel = () => {
      setEditing(false);
      setDraft(text);
    };
    return (
      <div className="flex justify-end">
        <div className="flex w-full max-w-[80%] flex-col items-end gap-1.5">
          <div className="w-full rounded-2xl rounded-br-sm bg-fg px-3.5 py-2 text-bg">
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                autoSize(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              rows={1}
              className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-bg placeholder:text-bg/60 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-fg-3">
            <span>Enter to send · Esc to cancel</span>
            <button
              type="button"
              onClick={cancel}
              className="rounded-md px-2 py-0.5 text-fg-2 hover:bg-bg-2 hover:text-fg-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || draft.trim() === text}
              className="rounded-md bg-fg px-2 py-0.5 font-medium text-bg hover:bg-fg-1 disabled:bg-bg-3 disabled:text-fg-3"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/user flex justify-end">
      <div className="flex max-w-[80%] flex-col items-end gap-1">
        <div className="rounded-2xl rounded-br-sm bg-fg px-3.5 py-2 text-[14px] leading-relaxed text-bg">
          <div className="markdown !text-bg [&_*]:!text-bg [&_a]:!text-bg [&_a]:!underline">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{text}</ReactMarkdown>
          </div>
        </div>
        {showActions ? (
          <UserMessageActions
            text={text}
            eventIndex={eventIndex}
            onRetry={onRetry}
            onEdit={onEdit ? () => setEditing(true) : undefined}
          />
        ) : null}
      </div>
    </div>
  );
}

function autoSize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
}

function UserMessageActions({
  text,
  eventIndex,
  onRetry,
  onEdit,
}: {
  text: string;
  eventIndex?: number;
  onRetry?: (eventIndex: number, text: string) => void;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-1 opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {}
        }}
        className="rounded-md p-1 text-fg-3 hover:bg-bg-2 hover:text-fg-1"
        title={copied ? "Copied" : "Copy"}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md p-1 text-fg-3 hover:bg-bg-2 hover:text-fg-1"
          title="Edit — wipes later messages and starts fresh"
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
      {onRetry && eventIndex != null ? (
        <button
          type="button"
          onClick={() => onRetry(eventIndex, text)}
          className="rounded-md p-1 text-fg-3 hover:bg-bg-2 hover:text-fg-1"
          title="Retry from here — wipes later messages"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
