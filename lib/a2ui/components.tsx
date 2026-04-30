"use client";

/**
 * Concrete React renderers for the analytics catalog. Imported once at app
 * startup (the Surface component calls `ensureRegistered()` lazily) so the
 * registry is populated before any rendering happens.
 */

import { useId } from "react";
import {
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, AlertOctagon } from "lucide-react";
import { registerComponent, renderChildren, type RenderContext } from "./renderer";
import type { A2UIComponent } from "./types";
import type {
  SectionProps,
  KPIProps,
  TableProps,
  ChartProps,
  CalloutProps,
  Mood,
  ChartDataPoint,
} from "./catalog";

let registered = false;

export function ensureRegistered(): void {
  if (registered) return;
  registered = true;

  registerComponent("Section", (comp: A2UIComponent, ctx: RenderContext) => {
    const p = comp as unknown as SectionProps & { id: string };
    return (
      <section key={p.id} className="space-y-2.5">
        {p.title ? (
          <div>
            <h3 className="text-[13.5px] font-semibold tracking-tight text-fg">
              {p.title}
            </h3>
            {p.subtitle ? (
              <p className="mt-0.5 text-[12px] text-fg-3">{p.subtitle}</p>
            ) : null}
          </div>
        ) : null}
        {p.children?.length ? (
          <div className="space-y-2">{renderChildren(p.children, ctx)}</div>
        ) : null}
      </section>
    );
  });

  registerComponent("KPI", (comp: A2UIComponent) => {
    const p = comp as unknown as KPIProps & { id: string };
    return <KPICard key={p.id} {...p} />;
  });

  registerComponent("Table", (comp: A2UIComponent) => {
    const p = comp as unknown as TableProps & { id: string };
    return <DataTable key={p.id} {...p} />;
  });

  registerComponent("Chart", (comp: A2UIComponent) => {
    const p = comp as unknown as ChartProps & { id: string };
    return <ChartCard key={p.id} {...p} />;
  });

  registerComponent("Callout", (comp: A2UIComponent) => {
    const p = comp as unknown as CalloutProps & { id: string };
    return <CalloutCard key={p.id} {...p} />;
  });
}

// ─── KPI ────────────────────────────────────────────────────────────────────

const MOOD_DOT: Record<Mood, string> = {
  good: "bg-good",
  watch: "bg-warn",
  act: "bg-bad",
};

function KPICard(p: KPIProps & { id: string }) {
  const delta = typeof p.deltaPct === "number" ? p.deltaPct : null;
  const isUp = delta != null && delta >= 0;
  return (
    <div className="rounded-md border border-line bg-bg p-3.5 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-1.5 eyebrow">
        {p.mood ? (
          <span className={`h-1.5 w-1.5 rounded-full ${MOOD_DOT[p.mood]}`} />
        ) : null}
        {p.label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[26px] font-semibold tabular tracking-tight text-fg">
          {p.value}
        </span>
        {delta != null ? (
          <span
            className={`inline-flex items-baseline gap-0.5 text-[12px] font-medium tabular ${
              isUp ? "text-good" : "text-bad"
            }`}
          >
            {isUp ? (
              <TrendingUp className="h-3 w-3 self-center" />
            ) : (
              <TrendingDown className="h-3 w-3 self-center" />
            )}
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : null}
      </div>
      {p.deltaLabel ? (
        <div className="mt-0.5 text-[11px] text-fg-3">{p.deltaLabel}</div>
      ) : null}
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

function DataTable(p: TableProps & { id: string }) {
  if (!p.columns?.length || !p.rows?.length) {
    return (
      <div className="rounded-md border border-line bg-bg-1 p-3 text-xs text-fg-3">
        (no rows)
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-line bg-bg">
      {p.caption ? (
        <div className="border-b border-line bg-bg-1 px-3 py-1.5 text-[11.5px] font-medium text-fg-1">
          {p.caption}
        </div>
      ) : null}
      <div className="max-h-96 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-bg-1 sticky top-0">
            <tr>
              {p.columns.map((c) => (
                <th
                  key={c}
                  className="whitespace-nowrap border-b border-line px-2.5 py-2 text-left text-[10.5px] font-medium uppercase tracking-wider text-fg-3"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((row, i) => (
              <tr key={i} className="border-b border-line last:border-0 hover:bg-bg-1">
                {p.columns.map((c) => (
                  <td
                    key={c}
                    className="whitespace-nowrap px-2.5 py-1.5 font-mono tabular text-fg-1"
                  >
                    {row[c] == null ? "" : String(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Chart ──────────────────────────────────────────────────────────────────

const ACCENT = "#4338ca"; // --accent (indigo-700)
const ACCENT_DEEP = "#312e81"; // --accent-deep (indigo-900)
const GRID_STROKE = "#e2e8f0"; // --line (slate-200)
const AXIS_TICK = { fontSize: 10.5, fill: "#94a3b8", fontVariantNumeric: "tabular-nums" } as const;

const ANIM = { isAnimationActive: true, animationDuration: 600, animationEasing: "ease-out" } as const;

/** Tooltip card — small dark panel, eyebrow label, tabular value. */
type TooltipPayload = {
  value?: number | string;
  name?: string | number;
  dataKey?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
};

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel,
  baselineLabel,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  valueLabel?: string;
  baselineLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-fg-1 bg-fg/95 px-2.5 py-1.5 text-bg shadow-lg backdrop-blur min-w-[120px]">
      {label != null ? (
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg-4">
          {String(label)}
        </div>
      ) : null}
      {payload.map((p, i) => {
        const isPrimary = p.dataKey === "v";
        const seriesLabel = isPrimary
          ? valueLabel ?? "Value"
          : baselineLabel ?? "Prior";
        return (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[10.5px] text-fg-4">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: p.color }}
              />
              {seriesLabel}
            </span>
            <span className="font-mono text-[12px] tabular font-semibold">
              {formatCompact(Number(p.value ?? 0))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Donut tooltip uses % of total, not absolute. */
function DonutTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const v = Number(p.value ?? 0);
  const pct = (v / (total || 1)) * 100;
  return (
    <div className="rounded-md border border-fg-1 bg-fg/95 px-2.5 py-1.5 text-bg shadow-lg backdrop-blur">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10.5px] text-fg-4">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: p.color }}
        />
        {String(p.name ?? "")}
      </div>
      <div className="font-mono text-[14px] tabular font-semibold">
        {formatCompact(v)}
        <span className="ml-1.5 text-[11px] font-normal text-fg-4">
          {pct.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function ChartCard(p: ChartProps & { id: string }) {
  if (!p.data?.length) {
    return (
      <div className="rounded-md border border-line bg-bg-1 p-3 text-xs text-fg-3">
        (no chart data)
      </div>
    );
  }
  const hasBaseline = p.data.some((d) => d.t != null);
  const stats = computeChartStats(p.data);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-bg">
      {(p.title || stats) ? (
        <div className="flex items-baseline justify-between gap-3 border-b border-line bg-bg-1 px-3.5 py-2">
          <div className="min-w-0">
            {p.title ? (
              <div className="truncate text-[12.5px] font-semibold text-fg">
                {p.title}
              </div>
            ) : null}
            {hasBaseline ? (
              <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-fg-3">
                <span className="flex items-center gap-1">
                  <span
                    className="h-0.5 w-3"
                    style={{ background: ACCENT }}
                  />
                  {p.valueLabel ?? "Value"}
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="h-0.5 w-3 border-t border-dashed"
                    style={{ borderColor: "#bbbbbb" }}
                  />
                  {p.baselineLabel ?? "Prior"}
                </span>
              </div>
            ) : null}
          </div>
          {stats ? (
            <div className="text-right">
              <div className="font-mono text-[14px] font-semibold tabular text-fg">
                {formatCompact(stats.total)}
              </div>
              {stats.delta != null ? (
                <div
                  className={`text-[10.5px] tabular ${
                    stats.delta >= 0 ? "text-good" : "text-bad"
                  }`}
                >
                  {stats.delta >= 0 ? "▲" : "▼"} {Math.abs(stats.delta).toFixed(1)}%
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="px-2 py-3">
        <ChartBody {...p} />
      </div>
    </div>
  );
}

// Plain helper, not a hook — renamed so eslint doesn't treat it like one.
function computeChartStats(data: ChartDataPoint[]) {
  if (!data.length) return null;
  const total = data.reduce((s, d) => s + (d.v ?? 0), 0);
  // Compare last vs first as a rough trend delta when there are 2+ points.
  let delta: number | null = null;
  if (data.length >= 2) {
    const a = data[0].v;
    const b = data[data.length - 1].v;
    if (a !== 0) delta = ((b - a) / Math.abs(a)) * 100;
  }
  return { total, delta };
}

function ChartBody(p: ChartProps) {
  const valueLabel = p.valueLabel ?? "Value";
  const baselineLabel = p.baselineLabel ?? "Prior";
  const data = p.data;
  const height = 220;
  const hasBaseline = data.some((d) => d.t != null);
  const id = useId();

  if (p.chartType === "donut") {
    return <DonutChart data={data} height={height} accent={ACCENT} />;
  }

  const tooltip = (
    <Tooltip
      cursor={{
        stroke: ACCENT,
        strokeWidth: 1,
        strokeDasharray: "3 3",
        fillOpacity: 0,
      }}
      content={
        <ChartTooltip valueLabel={valueLabel} baselineLabel={baselineLabel} />
      }
      animationDuration={0}
    />
  );

  const grid = (
    <CartesianGrid
      strokeDasharray="2 4"
      stroke={GRID_STROKE}
      vertical={false}
    />
  );

  const xAxis = (
    <XAxis
      dataKey="d"
      tick={AXIS_TICK}
      axisLine={false}
      tickLine={false}
      padding={{ left: 8, right: 8 }}
      tickMargin={6}
    />
  );
  const yAxis = (
    <YAxis
      tick={AXIS_TICK}
      axisLine={false}
      tickLine={false}
      width={36}
      tickFormatter={(v) => formatCompact(Number(v))}
    />
  );

  if (p.chartType === "bar") {
    const cursor = { fill: ACCENT, fillOpacity: 0.06 };
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} barSize={hasBaseline ? 14 : 18} barGap={3} margin={{ top: 8, right: 6, bottom: 4, left: 0 }}>
          {grid}
          {xAxis}
          {yAxis}
          <Tooltip
            cursor={cursor}
            content={<ChartTooltip valueLabel={valueLabel} baselineLabel={baselineLabel} />}
            animationDuration={0}
          />
          <defs>
            <linearGradient id={`bar-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={1} />
              <stop offset="100%" stopColor={ACCENT_DEEP} stopOpacity={0.85} />
            </linearGradient>
          </defs>
          <Bar
            dataKey="v"
            name={valueLabel}
            fill={`url(#bar-${id})`}
            radius={[4, 4, 0, 0]}
            activeBar={{ fill: ACCENT_DEEP }}
            {...ANIM}
          />
          {hasBaseline ? (
            <Bar
              dataKey="t"
              name={baselineLabel}
              fill={ACCENT}
              fillOpacity={0.18}
              radius={[4, 4, 0, 0]}
              {...ANIM}
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (p.chartType === "area") {
    const fillId = `area-${id}`;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.45} />
              <stop offset="55%" stopColor={ACCENT} stopOpacity={0.18} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          <Area
            type="monotone"
            dataKey="v"
            name={valueLabel}
            stroke={ACCENT}
            strokeWidth={2}
            fill={`url(#${fillId})`}
            dot={{ r: 3, fill: "#fff", stroke: ACCENT, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "#fff", stroke: ACCENT, strokeWidth: 2.5 }}
            {...ANIM}
          />
          {hasBaseline ? (
            <Area
              type="monotone"
              dataKey="t"
              name={baselineLabel}
              stroke="#bdbdbd"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              fill="transparent"
              dot={false}
              {...ANIM}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  // line (default)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 6, bottom: 4, left: 0 }}>
        {grid}
        {xAxis}
        {yAxis}
        {tooltip}
        <Line
          type="monotone"
          dataKey="v"
          name={valueLabel}
          stroke={ACCENT}
          strokeWidth={2.25}
          dot={{ r: 3, fill: "#fff", stroke: ACCENT, strokeWidth: 2 }}
          activeDot={{
            r: 5,
            fill: "#fff",
            stroke: ACCENT,
            strokeWidth: 2.5,
            style: { filter: `drop-shadow(0 0 4px ${ACCENT}80)` },
          }}
          {...ANIM}
        />
        {hasBaseline ? (
          <Line
            type="monotone"
            dataKey="t"
            name={baselineLabel}
            stroke="#bdbdbd"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            {...ANIM}
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}

function DonutChart({
  data,
  height,
  accent,
}: {
  data: ChartDataPoint[];
  height: number;
  accent: string;
}) {
  // Tonal ramp from indigo through violet and soft blues, then slate.
  // Cohesive jewel-tone family — every slice feels related.
  const COLORS = [accent, "#6366f1", "#8b5cf6", "#a78bfa", "#94a3b8", "#475569"];
  const total = data.reduce((s, d) => s + d.v, 0);
  const id = useId();
  return (
    <div className="flex flex-col items-stretch gap-2">
      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="v"
              nameKey="d"
              cx="50%"
              cy="50%"
              innerRadius={height * 0.32}
              outerRadius={height * 0.46}
              paddingAngle={2}
              strokeWidth={2}
              stroke="var(--bg)"
              {...ANIM}
            >
              {data.map((_, i) => (
                <Cell key={`${id}-${i}`} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={<DonutTooltip total={total} />}
              animationDuration={0}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label sits absolutely so it can be larger / typographically
            distinct without fighting recharts' <text> sizing constraints. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-fg-3">
            Total
          </div>
          <div className="font-mono text-[20px] tabular font-semibold text-fg">
            {formatCompact(total)}
          </div>
          <div className="text-[10.5px] text-fg-3">
            {data.length} {data.length === 1 ? "slice" : "slices"}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-1">
        {data.map((slice, i) => {
          const pct = (slice.v / (total || 1)) * 100;
          return (
            <div
              key={`${id}-leg-${i}`}
              className="flex items-baseline gap-1.5 text-[11px]"
            >
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="text-fg-1">{slice.d}</span>
              <span className="font-mono tabular text-fg-3">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n * 100) / 100);
}

// ─── Callout ────────────────────────────────────────────────────────────────

const CALLOUT_ICON = {
  good: <CheckCircle2 className="h-4 w-4" />,
  watch: <AlertTriangle className="h-4 w-4" />,
  act: <AlertOctagon className="h-4 w-4" />,
};

const CALLOUT_STYLE: Record<Mood, string> = {
  good: "border-l-2 border-good bg-bg-1 text-fg",
  watch: "border-l-2 border-warn bg-bg-1 text-fg",
  act: "border-l-2 border-bad bg-bg-1 text-fg",
};

const CALLOUT_ICON_TINT: Record<Mood, string> = {
  good: "text-good",
  watch: "text-warn",
  act: "text-bad",
};

function CalloutCard(p: CalloutProps & { id: string }) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-md p-3 text-[13.5px] ${CALLOUT_STYLE[p.mood]}`}
    >
      <span className={`mt-0.5 shrink-0 ${CALLOUT_ICON_TINT[p.mood]}`}>
        {CALLOUT_ICON[p.mood]}
      </span>
      <div className="min-w-0">
        {p.title ? (
          <div className="eyebrow mb-0.5">{p.title}</div>
        ) : null}
        <div className="text-fg">{p.text}</div>
      </div>
    </div>
  );
}
