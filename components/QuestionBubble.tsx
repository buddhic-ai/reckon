"use client";

import { useState } from "react";

export interface PendingQuestion {
  questionId: string;
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

interface Props {
  question: PendingQuestion;
  onAnswer: (questionId: string, answer: string) => void;
  answered?: string;
}

export function QuestionBubble({ question, onAnswer, answered }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [other, setOther] = useState("");

  if (answered !== undefined) {
    return (
      <div className="rounded-md border border-line bg-bg-1 p-3 text-[13px]">
        {question.header ? (
          <div className="mb-1 eyebrow text-accent">{question.header}</div>
        ) : null}
        <div className="mb-1.5 whitespace-pre-wrap text-fg">{question.question}</div>
        <div className="text-[11.5px] italic text-fg-3">
          You answered:{" "}
          <span className="font-medium not-italic text-fg-1">{answered}</span>
        </div>
      </div>
    );
  }

  function toggle(label: string) {
    if (question.multiSelect) {
      const next = new Set(picked);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      setPicked(next);
    } else {
      onAnswer(question.questionId, label);
    }
  }

  function submit() {
    const parts: string[] = [];
    if (picked.size) parts.push(Array.from(picked).join(", "));
    if (other.trim()) parts.push(other.trim());
    if (!parts.length) return;
    onAnswer(question.questionId, parts.join(" — "));
  }

  return (
    <div className="rounded-md border border-accent-soft bg-[color:color-mix(in_oklab,var(--accent)_5%,var(--bg))] p-3 text-[13px]">
      {question.header ? (
        <div className="mb-1.5 eyebrow text-accent-deep">{question.header}</div>
      ) : null}
      <div className="mb-2.5 whitespace-pre-wrap text-fg">{question.question}</div>
      {question.options && question.options.length ? (
        <div className="mb-2 flex flex-col gap-1">
          {question.options.map((opt) => {
            const checked = picked.has(opt.label);
            return (
              <button
                key={opt.label}
                onClick={() => toggle(opt.label)}
                className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                  checked
                    ? "border-accent bg-bg text-fg"
                    : "border-line bg-bg text-fg-1 hover:border-accent-soft"
                }`}
              >
                <span className="font-medium">{opt.label}</span>
                {opt.description ? (
                  <span className="text-[11.5px] text-fg-3">{opt.description}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Type a custom answer…"
          className="flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] focus:border-accent focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          onClick={submit}
          className="rounded-md bg-fg px-3 py-1.5 text-[12px] font-medium text-bg hover:bg-fg-1 disabled:bg-bg-3 disabled:text-fg-3"
          disabled={!other.trim() && picked.size === 0}
        >
          Send
        </button>
      </div>
    </div>
  );
}
