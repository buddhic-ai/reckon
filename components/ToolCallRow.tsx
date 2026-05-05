"use client";

import { useState, useMemo } from "react";
import { Wrench, CheckCircle2, AlertCircle, ChevronRight, Loader2 } from "lucide-react";
import type { RunEvent } from "@/lib/runtime/event-types";

type ToolCallEvent = Extract<RunEvent, { type: "tool_call" }>;
type ToolResultEvent = Extract<RunEvent, { type: "tool_result" }>;

interface Props {
  call: ToolCallEvent;
  result?: ToolResultEvent;
}

/**
 * One row per tool invocation, pairing a tool_call with its tool_result by
 * `toolUseId`. Collapsed by default; expanding reveals the full input
 * (pretty-printed; GraphQL extracted from `graphjin cli execute_graphql`)
 * and the full result (rendered as a table when JSON-detectable, otherwise
 * as a scrollable code block).
 */
export function ToolCallRow({ call, result }: Props) {
  const [open, setOpen] = useState(false);
  const status: "running" | "ok" | "err" = !result
    ? "running"
    : result.ok
    ? "ok"
    : "err";

  const headerLine = useMemo(() => callHeadline(call), [call]);

  return (
    <div
      className={`rounded-md border bg-bg text-xs transition-colors ${
        status === "err" ? "border-bad-soft" : "border-line hover:border-line-strong"
      }`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-fg-4 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <StatusIcon status={status} />
        <span className="font-mono text-[11px] font-medium text-fg-1">
          {call.tool}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-3">
          {headerLine}
        </span>
        {result?.summary ? (
          <span className="hidden max-w-[28%] truncate text-[11px] text-fg-3 sm:inline">
            → {result.summary.split("\n")[0]}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="border-t border-line px-2 pb-2 pt-1.5">
          <ToolInputView call={call} />
          {result ? <ToolResultView result={result} /> : (
            <div className="mt-2 text-[11px] italic text-fg-3">running…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: "running" | "ok" | "err" }) {
  if (status === "running")
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />;
  if (status === "ok")
    return <CheckCircle2 className="h-3 w-3 shrink-0 text-good" />;
  if (status === "err")
    return <AlertCircle className="h-3 w-3 shrink-0 text-bad" />;
  return <Wrench className="h-3 w-3 shrink-0 text-fg-3" />;
}

/** A short one-line header for the collapsed row. */
function callHeadline(call: ToolCallEvent): string {
  if (call.tool === "Bash") {
    const cmd = parseBashCommand(call);
    if (cmd) {
      const gq = extractGraphjinQuery(cmd);
      if (gq) return `graphjin · ${gq.opName ?? "query"}`;
      return cmd.split("\n")[0].slice(0, 140);
    }
  }
  if (call.tool === "Read" || call.tool === "Edit" || call.tool === "Write") {
    const path = readField(call, "file_path") ?? readField(call, "path");
    if (path) return String(path);
  }
  if (call.tool === "Glob" || call.tool === "Grep") {
    return readField(call, "pattern") ?? call.summary;
  }
  return call.summary || "";
}

function readField(call: ToolCallEvent, field: string): string | undefined {
  if (!call.argsJson) return undefined;
  try {
    const obj = JSON.parse(call.argsJson) as Record<string, unknown>;
    const v = obj[field];
    if (typeof v === "string") return v;
  } catch {}
  return undefined;
}

function parseBashCommand(call: ToolCallEvent): string | null {
  if (!call.argsJson) return null;
  try {
    const obj = JSON.parse(call.argsJson) as Record<string, unknown>;
    const cmd = obj.command;
    return typeof cmd === "string" ? cmd : null;
  } catch {
    return null;
  }
}

/** Extract a GraphQL query body from a `graphjin cli execute_graphql --args '{"query":"..."}'` invocation. */
function extractGraphjinQuery(cmd: string): { body: string; opName?: string } | null {
  if (!/\bgraphjin\b/.test(cmd)) return null;
  if (!/\bexecute_graphql\b|\bexecute_saved_query\b|\bexecute_workflow\b/.test(cmd)) return null;
  // The CLI takes a JSON object via --args '{...}' or --args "{...}".
  const m =
    cmd.match(/--args\s+'([\s\S]*?)'(?=\s|$)/) ||
    cmd.match(/--args\s+"([\s\S]*?)"(?=\s|$)/);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const body = (parsed as Record<string, unknown>).query;
  if (typeof body !== "string") return null;
  const opMatch = body.match(/\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return { body, opName: opMatch?.[2] };
}

function ToolInputView({ call }: { call: ToolCallEvent }) {
  if (call.tool === "Bash") {
    const cmd = parseBashCommand(call);
    if (cmd) {
      const gq = extractGraphjinQuery(cmd);
      if (gq) {
        return (
          <div className="space-y-1.5">
            <Label>graphjin query</Label>
            <pre className="overflow-x-auto rounded bg-fg px-2.5 py-2 font-mono text-[11px] leading-relaxed text-bg">
              <code>{highlightGraphql(gq.body.trim())}</code>
            </pre>
            <Label>full command</Label>
            <pre className="max-h-32 overflow-auto rounded bg-bg-2 px-2 py-1.5 font-mono text-[11px] text-fg-1">
              <code>{cmd}</code>
            </pre>
          </div>
        );
      }
      return (
        <div className="space-y-1">
          <Label>command</Label>
          <pre className="overflow-x-auto rounded bg-fg px-2.5 py-1.5 font-mono text-[11px] text-bg">
            <code>{cmd}</code>
          </pre>
        </div>
      );
    }
  }
  return (
    <div className="space-y-1">
      <Label>input</Label>
      <pre className="max-h-48 overflow-auto rounded bg-bg-2 px-2 py-1.5 font-mono text-[11px] text-fg-1">
        <code>{call.argsJson || call.summary || "(no input)"}</code>
      </pre>
    </div>
  );
}

function ToolResultView({ result }: { result: ToolResultEvent }) {
  const text = result.text ?? result.summary ?? "";
  const table = useMemo(() => detectGraphjinTable(text), [text]);
  return (
    <div className="mt-2 space-y-1">
      <Label>{result.ok ? "result" : "error"}</Label>
      {table ? (
        <ResultTable columns={table.columns} rows={table.rows} truncated={table.truncated} totalRows={table.totalRows} />
      ) : (
        <pre className="max-h-72 overflow-auto rounded bg-bg-2 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-fg-1">
          <code>{text || "(empty)"}</code>
        </pre>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

/**
 * Look for the first JSON object in the result text and try to extract a tabular
 * record set out of it. Handles GraphJin's `{ "data": { "<table>": [ rows ] } }`
 * shape and bare arrays of objects.
 */
function detectGraphjinTable(text: string): {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  totalRows: number;
} | null {
  if (!text) return null;
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  const firstBrace = start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart);
  if (firstBrace === -1) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(firstBrace));
  } catch {
    return null;
  }
  const rowsAny = findFirstArrayOfObjects(parsed);
  if (!rowsAny || rowsAny.length === 0) return null;
  const cols = Array.from(
    new Set(rowsAny.flatMap((r) => Object.keys(r as Record<string, unknown>)))
  );
  const cap = 50;
  const truncated = rowsAny.length > cap;
  return {
    columns: cols,
    rows: rowsAny.slice(0, cap),
    truncated,
    totalRows: rowsAny.length,
  };
}

function findFirstArrayOfObjects(v: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && !Array.isArray(v[0])) {
    return v as Record<string, unknown>[];
  }
  if (v && typeof v === "object") {
    for (const child of Object.values(v as Record<string, unknown>)) {
      const found = findFirstArrayOfObjects(child);
      if (found) return found;
    }
  }
  return null;
}

function ResultTable({
  columns,
  rows,
  truncated,
  totalRows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  totalRows: number;
}) {
  return (
    <div className="overflow-auto rounded border border-line">
      <table className="min-w-full text-[11px]">
        <thead className="bg-bg-1">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                className="whitespace-nowrap border-b border-line px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-fg-3"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-bg even:bg-bg-1">
              {columns.map((c) => (
                <td
                  key={c}
                  className="whitespace-nowrap border-b border-line px-2 py-1 font-mono tabular text-fg-1"
                >
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated ? (
        <div className="bg-bg-1 px-2 py-1 text-[10px] text-fg-3">
          showing first {rows.length} of {totalRows} rows
        </div>
      ) : null}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 77) + "…" : v;
  return JSON.stringify(v);
}

/**
 * Cheap GraphQL syntax highlighter that returns a single string with no React
 * children — we use plain class-based spans by emitting React nodes via a
 * minimal tokenizer. Keep it lightweight; we avoid pulling in highlight.js.
 */
function highlightGraphql(src: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const re = /(#[^\n]*)|("(?:[^"\\]|\\.)*")|(\b(?:query|mutation|subscription|fragment|on|true|false|null)\b)|(\$[A-Za-z_][A-Za-z0-9_]*)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) tokens.push(<span key={`p${key++}`}>{src.slice(last, m.index)}</span>);
    // Quiet syntax theme — indigo family on dark slate, no neon.
    if (m[1]) tokens.push(<span key={`c${key++}`} className="text-fg-4 italic">{m[1]}</span>);
    else if (m[2]) tokens.push(<span key={`s${key++}`} style={{ color: "#86efac" }}>{m[2]}</span>);
    else if (m[3]) tokens.push(<span key={`k${key++}`} style={{ color: "#a5b4fc" }} className="font-semibold">{m[3]}</span>);
    else if (m[4]) tokens.push(<span key={`v${key++}`} style={{ color: "#c7d2fe" }}>{m[4]}</span>);
    else if (m[5]) tokens.push(<span key={`n${key++}`} style={{ color: "#c7d2fe" }}>{m[5]}</span>);
    else if (m[6]) tokens.push(<span key={`i${key++}`} className="text-bg">{m[6]}</span>);
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push(<span key={`tail`}>{src.slice(last)}</span>);
  return tokens;
}
