"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { TIPS } from "@/lib/tips";

const STORAGE_KEY = "reckon:tips:v1";

type TipsState = { seen: string[]; dismissed: boolean };

function loadState(): TipsState {
  if (typeof window === "undefined") return { seen: [], dismissed: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { seen: [], dismissed: false };
    const parsed = JSON.parse(raw) as Partial<TipsState>;
    return { seen: parsed.seen ?? [], dismissed: !!parsed.dismissed };
  } catch {
    return { seen: [], dismissed: false };
  }
}

function saveState(s: TipsState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode — no-op */
  }
}

function firstUnseenIndex(state: TipsState): number {
  const idx = TIPS.findIndex((t) => !state.seen.includes(t.id));
  return idx === -1 ? 0 : idx;
}

/**
 * Single rotating tip card for the home empty state. Picks the next unseen tip,
 * advances on prev/next, persists `seen` across sessions, and retires itself
 * when every tip has been viewed (or the user clicks "Don't show again").
 */
export function TipCard() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<TipsState>({ seen: [], dismissed: false });
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const initial = loadState();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(initial);
    setIndex(firstUnseenIndex(initial));
    setReady(true);
  }, []);

  // Mark each tip the user lands on as seen exactly once per mount.
  const markedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!ready) return;
    const tip = TIPS[index];
    if (markedRef.current.has(tip.id)) return;
    markedRef.current.add(tip.id);
    setState((prev) => {
      if (prev.seen.includes(tip.id)) return prev;
      const next = { ...prev, seen: [...prev.seen, tip.id] };
      saveState(next);
      return next;
    });
  }, [ready, index]);

  const dismissForever = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, dismissed: true };
      saveState(next);
      return next;
    });
  }, []);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % TIPS.length);
  }, []);
  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + TIPS.length) % TIPS.length);
  }, []);

  const tip = useMemo(() => TIPS[index], [index]);
  const total = TIPS.length;

  if (!ready) return null;
  if (state.dismissed) return null;
  if (state.seen.length >= TIPS.length) return null;

  return (
    <div
      role="region"
      aria-label="Tip"
      className="fade-in-up relative rounded-md border border-line bg-bg-1 px-3 py-2.5"
    >
      <button
        type="button"
        onClick={dismissForever}
        aria-label="Don't show tips again"
        title="Don't show tips again"
        className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded text-fg-3 transition-colors hover:bg-bg-2 hover:text-fg-1"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>

      <div className="flex items-start gap-2.5 pr-7">
        <Lightbulb
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="eyebrow truncate">Tip · {tip.category}</span>
            <span className="font-mono text-[10.5px] tabular text-fg-3">
              {String(index + 1).padStart(2, "0")} /{" "}
              {String(total).padStart(2, "0")}
            </span>
          </div>
          <div className="mt-1 text-[12.5px] font-medium leading-snug text-fg">
            {tip.title}
          </div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-fg-2">
            {tip.body}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <button
              type="button"
              onClick={dismissForever}
              className="text-fg-3 transition-colors hover:text-fg-1"
            >
              Don&apos;t show again
            </button>
            <div className="flex items-center gap-3 font-mono">
              <button
                type="button"
                onClick={prev}
                className="text-fg-3 transition-colors hover:text-fg-1"
                aria-label="Previous tip"
              >
                ← prev
              </button>
              <button
                type="button"
                onClick={next}
                className="text-fg-3 transition-colors hover:text-fg-1"
                aria-label="Next tip"
              >
                next →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
