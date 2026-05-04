"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ArrowUp, Clock, Paperclip, Square, X } from "lucide-react";

export interface ComposerHandle {
  /** Replace the composer's draft with `text` and focus the textarea. */
  setText: (text: string) => void;
}

interface SkillRow {
  name: string;
  description: string;
}

interface MentionState {
  start: number;
  query: string;
}

// Max rows shown in the picker. The list scrolls internally if the user
// narrows past this with a query.
const MENTION_LIMIT = 5;

/**
 * Walk backwards from the caret looking for an `@` that opens a mention. The
 * trigger is only active when `@` follows whitespace or string start, and the
 * range between `@` and the caret contains no whitespace.
 */
function detectMention(value: string, caret: number): MentionState | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "@") {
      const prev = i > 0 ? value[i - 1] : "";
      if (i === 0 || /\s/.test(prev)) {
        const query = value.slice(i + 1, caret);
        if (!/\s/.test(query)) return { start: i, query };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

interface Props {
  onSend: (text: string, files: File[]) => void;
  disabled?: boolean;
  placeholder?: string;
  hideAttach?: boolean;
  draftKey?: string;
  /**
   * When set and `disabled` is true (i.e. an agent is currently streaming),
   * the Send button is replaced by a Stop button that calls this. Used by the
   * chat page to abort an in-flight run.
   */
  onStop?: () => void;
}

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024;
const MAX_TEXTAREA_HEIGHT = 470;

/**
 * Composer is one bordered shell containing the textarea, attachments, and
 * actions. Attach + send live inside the shell so the whole input feels like
 * a single object, not three buttons in a row.
 */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { onSend, disabled, placeholder, hideAttach, draftKey, onStop },
  ref
) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [queue, setQueue] = useState<{ id: string; text: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hydrated = useRef(false);
  const queueIdRef = useRef(0);
  const prevDisabledRef = useRef<boolean>(disabled === true);
  const queueRef = useRef(queue);
  const onSendRef = useRef(onSend);
  queueRef.current = queue;
  onSendRef.current = onSend;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills")
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((d: { skills?: SkillRow[] }) => {
        if (!cancelled) setSkills(d.skills ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSkills = mention
    ? skills
        .filter((s) => {
          const q = mention.query.toLowerCase();
          if (!q) return true;
          return (
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
          );
        })
        .slice(0, MENTION_LIMIT)
    : [];
  const mentionOpen = mention !== null && filteredSkills.length > 0;
  const highlightedSkill = mentionOpen ? filteredSkills[mentionIdx] : null;

  useImperativeHandle(
    ref,
    () => ({
      setText: (t: string) => {
        setText(t);
        // Defer focus until after the controlled value lands in the DOM.
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          // Place caret at the end so the user can keep typing or just hit Enter.
          el.setSelectionRange(t.length, t.length);
        });
      },
    }),
    []
  );

  useEffect(() => {
    if (!draftKey || hydrated.current) return;
    hydrated.current = true;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) setText(saved);
    } catch {}
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || !hydrated.current) return;
    const t = setTimeout(() => {
      try {
        if (text) localStorage.setItem(draftKey, text);
        else localStorage.removeItem(draftKey);
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [text, draftKey]);

  // Auto-grow the textarea up to ~20 lines, then let it scroll internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  // When the agent finishes (disabled flips true → false) and we have queued
  // messages, flush them as one combined send. Joining with a blank line keeps
  // them visually distinct in the resulting transcript.
  useEffect(() => {
    const wasDisabled = prevDisabledRef.current;
    const nowDisabled = disabled === true;
    if (wasDisabled && !nowDisabled && queueRef.current.length > 0) {
      const combined = queueRef.current.map((q) => q.text).join("\n\n");
      setQueue([]);
      onSendRef.current(combined, []);
    }
    prevDisabledRef.current = nowDisabled;
  }, [disabled]);

  function insertMention(skill: SkillRow) {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length);
    const insert = `@${skill.name} `;
    const next = before + insert + after;
    setText(next);
    setMention(null);
    setMentionIdx(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const caret = before.length + insert.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function refreshMentionFromEl(el: HTMLTextAreaElement) {
    const caret = el.selectionStart ?? el.value.length;
    const next = detectMention(el.value, caret);
    setMention(next);
    if (!next) setMentionIdx(0);
  }

  function submit() {
    const t = text.trim();
    // While the agent is responding, hitting send queues the message instead
    // of dispatching it. The flush effect above sends everything queued as a
    // single combined message once `disabled` flips back to false.
    if (disabled) {
      if (!t) return;
      const id = `q${++queueIdRef.current}`;
      setQueue((q) => [...q, { id, text: t }]);
      setText("");
      setError(null);
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {}
      }
      return;
    }
    if (!t && files.length === 0) return;
    onSend(t, files);
    setText("");
    setFiles([]);
    setError(null);
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey);
      } catch {}
    }
  }

  function removeQueued(id: string) {
    setQueue((q) => q.filter((item) => item.id !== id));
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    const next = [...files];
    let err: string | null = null;
    for (const f of picked) {
      if (next.length >= MAX_FILES) {
        err = `Max ${MAX_FILES} files per message.`;
        break;
      }
      if (f.size > MAX_SIZE) {
        err = `"${f.name}" is over 10 MB and was skipped.`;
        continue;
      }
      if (f.type.startsWith("image/")) {
        err = `Image uploads aren't supported yet — "${f.name}" was skipped.`;
        continue;
      }
      next.push(f);
    }
    setFiles(next);
    setError(err);
  }

  function removeFile(idx: number) {
    setFiles((fs) => fs.filter((_, i) => i !== idx));
  }

  const trimmed = text.trim();
  const canSend = !disabled && (trimmed.length > 0 || files.length > 0);
  const canQueue = disabled === true && trimmed.length > 0;

  return (
    <div className="px-4 pb-4 pt-1">
      <div className="relative mx-auto max-w-3xl">
        {mentionOpen ? (
          // Master/detail picker: skills list on the left, full description of
          // the highlighted skill on the right. Same pattern as Raycast and
          // macOS Spotlight — long descriptions live in the detail pane and
          // scroll independently, so nothing ever overflows the viewport
          // regardless of screen width. Detail follows mentionIdx so keyboard
          // and mouse navigation produce the same preview.
          <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-lg border border-line bg-bg shadow-[0_8px_24px_rgba(15,23,42,0.08),_0_2px_4px_rgba(15,23,42,0.05)]">
            <div className="flex items-center justify-between border-b border-line bg-bg-1 px-3 py-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-3">
              <span>Skills</span>
              <span className="font-mono text-[10px] tabular text-fg-4">
                {filteredSkills.length}
              </span>
            </div>
            <div className="flex">
              <ul
                role="listbox"
                className="max-h-[14rem] w-60 shrink-0 overflow-y-auto border-r border-line bg-bg-1/40 py-1"
              >
                {filteredSkills.map((s, i) => (
                  <li
                    key={s.name}
                    role="option"
                    aria-selected={i === mentionIdx}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(s);
                    }}
                    onMouseEnter={() => setMentionIdx(i)}
                    className={`cursor-pointer border-l-2 px-3 py-1.5 transition-colors ${
                      i === mentionIdx
                        ? "border-fg bg-bg text-fg"
                        : "border-transparent text-fg-1 hover:bg-bg/60"
                    }`}
                  >
                    <div className="font-mono text-[12px] font-medium">
                      @{s.name}
                    </div>
                    {s.description ? (
                      <div className="truncate text-[11px] text-fg-3">
                        {s.description}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div
                aria-live="polite"
                className="flex max-h-[14rem] min-w-0 flex-1 flex-col overflow-y-auto px-4 py-3"
              >
                {highlightedSkill ? (
                  <>
                    <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-line pb-2">
                      <span className="font-mono text-[12.5px] font-medium text-fg">
                        @{highlightedSkill.name}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-fg-4">
                        ↵ to insert
                      </span>
                    </div>
                    {highlightedSkill.description ? (
                      <p className="whitespace-pre-line text-[12px] leading-relaxed text-fg-2">
                        {highlightedSkill.description}
                      </p>
                    ) : (
                      <p className="text-[11.5px] italic text-fg-4">
                        No description provided for this skill.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        <div className="rounded-2xl border border-line bg-bg shadow-[0_4px_16px_rgba(15,23,42,0.06),_0_1px_3px_rgba(15,23,42,0.04)] focus-within:border-line-strong focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.08),_0_2px_4px_rgba(15,23,42,0.05)] transition-shadow">
          {queue.length > 0 ? (
            // Queued follow-ups stack above the draft. They flush as a single
            // combined message the moment the agent finishes (`disabled`
            // returns to false) — see the flush effect.
            <div className="flex flex-col gap-1 border-b border-line bg-bg-1/30 px-3 pt-2 pb-2">
              <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-fg-4">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3" aria-hidden />
                  Queued · {queue.length}
                </span>
                <span className="text-[10px] tracking-wide text-fg-4">
                  Sends together when ready
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {queue.map((item, i) => (
                  <li
                    key={item.id}
                    className="group flex items-start gap-2 rounded-md bg-bg px-2 py-1 text-[12px] text-fg-1 ring-1 ring-line/60 transition-colors hover:ring-line"
                  >
                    <span className="mt-0.5 shrink-0 font-mono text-[10px] tabular text-fg-4">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <p className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words leading-snug">
                      {item.text}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeQueued(item.id)}
                      aria-label="Remove from queue"
                      title="Remove from queue"
                      className="shrink-0 rounded p-0.5 text-fg-3 transition-colors hover:bg-bg-2 hover:text-fg"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {files.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-b border-line px-3 pt-2.5 pb-2">
              {files.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-bg-2 py-0.5 pl-2 pr-1 text-[11.5px] text-fg-1"
                >
                  <Paperclip className="h-3 w-3 text-fg-3" />
                  <span className="max-w-[180px] truncate">{f.name}</span>
                  <span className="font-mono text-[10px] tabular text-fg-3">
                    {(f.size / 1024).toFixed(0)}k
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="rounded p-0.5 text-fg-3 hover:bg-bg-3 hover:text-fg"
                    title="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              refreshMentionFromEl(e.currentTarget);
            }}
            onSelect={(e) => refreshMentionFromEl(e.currentTarget)}
            onBlur={() => {
              // Defer so click-on-option (onMouseDown) lands first.
              setTimeout(() => setMention(null), 100);
            }}
            rows={2}
            // Intentionally not disabled while the agent is running — typing
            // routes into the queue (see `submit`). Keeping the field live
            // means follow-up thoughts don't get blocked behind the response.
            placeholder={
              placeholder ?? (disabled ? "Queue a follow-up…" : "Send a message…")
            }
            style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
            className="composer-input px-3 pt-2.5 overflow-y-auto"
            onKeyDown={(e) => {
              if (mentionOpen) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIdx((i) => (i + 1) % filteredSkills.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIdx(
                    (i) =>
                      (i - 1 + filteredSkills.length) % filteredSkills.length
                  );
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  insertMention(filteredSkills[mentionIdx]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
            <div className="flex items-center gap-1">
              {!hideAttach ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || files.length >= MAX_FILES}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-bg-2 hover:text-fg-1 disabled:opacity-40"
                  title="Attach file"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.xlsx,.pptx,.csv,.txt,.md,.json,.html"
                className="hidden"
                onChange={onPickFiles}
              />
              {error ? (
                <span className="ml-1 text-[11px] text-bad">{error}</span>
              ) : (
                <span className="ml-1 text-[11px] text-fg-4">
                  {disabled
                    ? "Enter to queue · Shift+Enter for newline"
                    : "Enter to send · Shift+Enter for newline"}
                </span>
              )}
            </div>

            {disabled && onStop ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onStop}
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-bad px-2.5 text-[12px] font-medium text-white transition-all hover:opacity-90"
                  title="Stop the agent"
                >
                  <Square className="h-3 w-3 fill-current" />
                  Stop
                </button>
                {canQueue ? (
                  <button
                    onClick={submit}
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-bg px-2.5 text-[12px] font-medium text-fg-1 transition-all hover:border-line-strong hover:bg-bg-1"
                    title="Add to queue · sends after the current response"
                  >
                    <Clock className="h-3 w-3" />
                    Queue
                  </button>
                ) : null}
              </div>
            ) : (
              <button
                onClick={submit}
                disabled={!canSend}
                className="group inline-flex h-7 items-center gap-1 rounded-md bg-fg px-2.5 text-[12px] font-medium text-bg transition-all hover:bg-fg-1 disabled:bg-bg-3 disabled:text-fg-3"
              >
                Send
                <ArrowUp className="h-3 w-3 transition-transform group-hover:-translate-y-0.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
