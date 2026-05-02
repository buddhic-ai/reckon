"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";

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

const MENTION_LIMIT = 6;

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hydrated = useRef(false);

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
    if ((!t && files.length === 0) || disabled) return;
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

  const canSend = !disabled && (text.trim().length > 0 || files.length > 0);

  return (
    <div className="px-4 pb-4 pt-1">
      <div className="relative mx-auto max-w-3xl">
        {mentionOpen ? (
          <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-lg border border-line bg-bg shadow-[0_8px_24px_rgba(15,23,42,0.08),_0_2px_4px_rgba(15,23,42,0.05)]">
            <div className="border-b border-line bg-bg-1 px-3 py-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-3">
              Skills
            </div>
            <ul role="listbox" className="max-h-72 overflow-y-auto">
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
                  className={`cursor-pointer px-3 py-1.5 ${
                    i === mentionIdx ? "bg-bg-2" : "hover:bg-bg-1"
                  }`}
                >
                  <div className="font-mono text-[12px] font-medium text-fg">
                    @{s.name}
                  </div>
                  {s.description ? (
                    <div className="truncate text-[11.5px] text-fg-3">
                      {s.description}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="rounded-2xl border border-line bg-bg shadow-[0_4px_16px_rgba(15,23,42,0.06),_0_1px_3px_rgba(15,23,42,0.04)] focus-within:border-line-strong focus-within:shadow-[0_6px_22px_rgba(15,23,42,0.08),_0_2px_4px_rgba(15,23,42,0.05)] transition-shadow">
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
            disabled={disabled}
            placeholder={placeholder ?? "Send a message…"}
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
                  Enter to send · Shift+Enter for newline
                </span>
              )}
            </div>

            {disabled && onStop ? (
              <button
                onClick={onStop}
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-md bg-bad px-2.5 text-[12px] font-medium text-white transition-all hover:opacity-90"
                title="Stop the agent"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </button>
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
