"use client";

import { TipCard } from "@/components/TipCard";

const STORAGE_KEY = "reckon:tips:v1";

/**
 * Standalone preview of the home tip card. The reset button clears the
 * localStorage key the real component uses, so re-running through the rotation
 * is a one-click affair.
 */
export default function TipsPreviewPage() {
  function reset() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no-op */
    }
    window.location.reload();
  }

  return (
    <main className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="eyebrow">Tip card preview</span>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-dashed border-line-strong px-2.5 py-1 font-mono text-[11px] text-fg-2 hover:bg-bg-1"
        >
          reset state
        </button>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-2xl">
          <div className="mb-6">
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-fg">
              What do you want to know?
            </h1>
            <p className="mt-1.5 text-[14px] text-fg-2">
              Faux home empty state — the card sits where the GitBranch hint
              normally lives.
            </p>
          </div>

          <TipCard />
        </div>
      </section>
    </main>
  );
}
