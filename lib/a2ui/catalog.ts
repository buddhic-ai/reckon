/**
 * Analytics catalog — domain-specific A2UI components the agent emits via
 * `mcp__ui__present`. Kept narrow on purpose; five types cover most analyst
 * answers (mirrors the "5 chart types cover 92%" insight from Neko's catalog).
 *
 * Components:
 *   Section  — heading + subtitle + ordered children
 *   KPI      — single metric with label, optional delta and mood
 *   Table    — column headers + array of row objects
 *   Chart    — line | bar | area | donut + ChartDataPoint[]
 *   Callout  — mood (good | watch | act) + body text
 *
 * All component property values support A2UI data binding via `{ path: "/..." }`,
 * but the in-process present() tool emits resolved values inline today; binding
 * is reserved for streaming updates if we add them later.
 */

export const CATALOG_ID = "urn:agent:catalog:analytics:v1";

export const ComponentTypes = {
  Section: "Section",
  KPI: "KPI",
  Table: "Table",
  Chart: "Chart",
  Callout: "Callout",
} as const;

export type Mood = "good" | "watch" | "act";
export type ChartType = "line" | "bar" | "area" | "donut";

export interface ChartDataPoint {
  /** Category label or x-axis tick (e.g. "Mon", "Q1", "North America"). */
  d: string;
  /** Primary value. */
  v: number;
  /** Optional comparison / baseline value. */
  t?: number;
}

export interface SectionProps {
  component: "Section";
  title?: string;
  subtitle?: string;
  /** IDs of child components rendered in order. */
  children: string[];
}

export interface KPIProps {
  component: "KPI";
  label: string;
  /** Display string — agent can pre-format with currency, units, etc. */
  value: string;
  /** Percent delta vs prior period. Negative is a decrease. */
  deltaPct?: number;
  /** Optional supporting text (e.g. "vs prior week"). */
  deltaLabel?: string;
  mood?: Mood;
}

export interface TableProps {
  component: "Table";
  columns: string[];
  rows: Array<Record<string, string | number>>;
  /** Optional caption shown above the table. */
  caption?: string;
}

export interface ChartProps {
  component: "Chart";
  chartType: ChartType;
  data: ChartDataPoint[];
  title?: string;
  /** Label for the primary series (defaults to "Value"). */
  valueLabel?: string;
  /** Label for the secondary/comparison series (defaults to "Prior"). */
  baselineLabel?: string;
}

export interface CalloutProps {
  component: "Callout";
  mood: Mood;
  text: string;
  /** Optional title above the body. */
  title?: string;
}

export type ComponentProps =
  | SectionProps
  | KPIProps
  | TableProps
  | ChartProps
  | CalloutProps;
