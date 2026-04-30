/**
 * A2UI v0.9 protocol types.
 *
 * Ported from Neko (apps/web/src/a2ui/types.ts) — the engine is generic, the
 * domain catalog lives in catalog.ts. Components reference data via JSON
 * pointers (`{ path: "/foo/bar" }`) so the agent can stream the component
 * tree once and push data updates without resending structure.
 */

export type DynamicValue<T> = T | { path: string };

export interface A2UIComponent {
  id: string;
  component: string;
  [key: string]: unknown;
}

export interface CreateSurfaceMessage {
  version: "v0.9";
  createSurface: {
    surfaceId: string;
    catalogId: string;
    theme?: Record<string, unknown>;
  };
}

export interface UpdateComponentsMessage {
  version: "v0.9";
  updateComponents: {
    surfaceId: string;
    components: A2UIComponent[];
  };
}

export interface UpdateDataModelMessage {
  version: "v0.9";
  updateDataModel: {
    surfaceId: string;
    /** JSON Pointer; defaults to "/". */
    path?: string;
    /** Omit to delete the value at `path`. */
    value?: unknown;
  };
}

export interface DeleteSurfaceMessage {
  version: "v0.9";
  deleteSurface: { surfaceId: string };
}

export type A2UIMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

export interface SurfaceState {
  surfaceId: string;
  catalogId: string;
  components: Map<string, A2UIComponent>;
  dataModel: Record<string, unknown>;
  theme?: Record<string, unknown>;
}
