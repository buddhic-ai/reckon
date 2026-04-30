"use client";

import type { A2UIComponent, SurfaceState } from "./types";
import { resolveComponent } from "./surface";

/**
 * Component registry. Domain renderers register themselves once at module load
 * (see lib/a2ui/components.tsx) and the surface page looks them up by name.
 */

export type ComponentRenderer = (
  component: A2UIComponent,
  context: RenderContext
) => React.ReactNode;

export interface RenderContext {
  surface: SurfaceState;
}

const registry = new Map<string, ComponentRenderer>();

export function registerComponent(type: string, renderer: ComponentRenderer): void {
  registry.set(type, renderer);
}

export function renderComponent(
  component: A2UIComponent,
  context: RenderContext
): React.ReactNode {
  const resolved = resolveComponent(component, context.surface.dataModel);
  const renderer = registry.get(resolved.component);
  if (!renderer) {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
        unknown component: <code>{resolved.component}</code>
      </div>
    );
  }
  return renderer(resolved, context);
}

export function renderChildren(
  childIds: string[],
  context: RenderContext
): React.ReactNode[] {
  return childIds
    .map((id) => {
      const comp = context.surface.components.get(id);
      if (!comp) return null;
      return renderComponent(comp, context);
    })
    .filter(Boolean);
}
