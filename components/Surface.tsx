"use client";

import { useMemo } from "react";
import type { A2UIMessage, SurfaceState } from "@/lib/a2ui/types";
import { applyMessage, getRootComponent } from "@/lib/a2ui/surface";
import { renderComponent, renderChildren } from "@/lib/a2ui/renderer";
import { ensureRegistered } from "@/lib/a2ui/components";

interface Props {
  messages: A2UIMessage[];
}

/**
 * Folds a stream of A2UI messages into surface state and renders each surface
 * (root-component-first). Used inside ChatThread when a `surface` event is
 * encountered.
 */
export function Surface({ messages }: Props) {
  ensureRegistered();
  const surfaces = useMemo(() => {
    let acc = new Map<string, SurfaceState>();
    for (const m of messages) acc = applyMessage(acc, m);
    return acc;
  }, [messages]);

  const items: React.ReactNode[] = [];
  for (const [, surface] of surfaces) {
    const ctx = { surface };
    const root = getRootComponent(surface);
    if (root) {
      items.push(
        <div key={surface.surfaceId} className="space-y-2">
          {renderComponent(root, ctx)}
        </div>
      );
      continue;
    }
    // No root — render every component in insertion order.
    const ids = Array.from(surface.components.keys());
    if (ids.length) {
      items.push(
        <div key={surface.surfaceId} className="space-y-2">
          {renderChildren(ids, ctx)}
        </div>
      );
    }
  }
  if (items.length === 0) return null;
  return <div className="space-y-3">{items}</div>;
}
