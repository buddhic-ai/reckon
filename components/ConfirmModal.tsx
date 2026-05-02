"use client";

import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive (red) style. */
  destructive?: boolean;
}

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function cleanup() {
  const root = activeRoot;
  const container = activeContainer;
  activeRoot = null;
  activeContainer = null;
  if (root) {
    // Defer unmount to the next tick — React forbids unmounting from inside
    // a render/commit triggered by the same root.
    queueMicrotask(() => {
      try {
        root.unmount();
      } catch {
        // already unmounted
      }
      if (container?.parentElement) {
        container.parentElement.removeChild(container);
      }
    });
  }
}

/**
 * Imperative confirmation modal. Resolves to true on confirm, false on
 * cancel / Escape / backdrop click. Replaces `window.confirm()` so the
 * prompt sits inside the app's design system instead of the browser's
 * native chrome.
 *
 *   const ok = await confirmDialog({
 *     title: 'Delete chat "Q3 review"?',
 *     description: "This also removes the chat's run history.",
 *     confirmLabel: "Delete",
 *     destructive: true,
 *   });
 *   if (!ok) return;
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  // Only one dialog at a time — a fresh call replaces any existing one.
  cleanup();
  return new Promise<boolean>((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    activeContainer = container;
    const root = createRoot(container);
    activeRoot = root;

    const onChoice = (choice: boolean) => {
      cleanup();
      resolve(choice);
    };

    root.render(<ConfirmDialog options={options} onChoice={onChoice} />);
  });
}

function ConfirmDialog({
  options,
  onChoice,
}: {
  options: ConfirmDialogOptions;
  onChoice: (choice: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onChoice(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onChoice(true);
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onChoice]);

  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onChoice(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md rounded-lg border border-line bg-bg p-5 shadow-xl">
        <h2
          id="confirm-modal-title"
          className="text-[15px] font-semibold tracking-tight text-fg"
        >
          {options.title}
        </h2>
        {options.description && (
          <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
            {options.description}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onChoice(false)}
            className="rounded-md border border-line bg-bg-2 px-3 py-1.5 text-[13px] font-medium text-fg-1 hover:bg-bg-3"
          >
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => onChoice(true)}
            className={
              options.destructive
                ? "rounded-md bg-bad px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                : "rounded-md bg-fg px-3 py-1.5 text-[13px] font-medium text-bg hover:bg-fg-1"
            }
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
