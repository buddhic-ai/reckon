import { spawn } from "node:child_process";

/**
 * Run a SQL query through `psql` and parse the result into row objects.
 * Uses CSV output via the COPY-style `-c '\copy (sql) TO STDOUT WITH CSV HEADER'`
 * trick (no, simpler: -A -F\\t -P "footer=off" gives us tab-separated rows
 * with a header line we can split).
 */

export interface PsqlResult {
  columns: string[];
  rows: Record<string, string>[];
  rawText: string;
}

export interface PsqlError {
  ok: false;
  error: string;
  rawText: string;
}

export type PsqlOutcome = ({ ok: true } & PsqlResult) | PsqlError;

export async function runPsql(connectionString: string, sql: string): Promise<PsqlOutcome> {
  return new Promise((resolve) => {
    const args = [
      connectionString,
      "-X", // ignore .psqlrc
      "-P",
      "footer=off",
      "--csv", // RFC4180-ish CSV with header row
      "-c",
      sql,
    ];
    const child = spawn("psql", args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => {
      resolve({ ok: false, error: err.message, rawText: "" });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: stderr.trim() || `psql exited ${code}`,
          rawText: stdout,
        });
        return;
      }
      const parsed = parseCsv(stdout);
      resolve({ ok: true, ...parsed, rawText: stdout });
    });
  });
}

/**
 * Lightweight CSV parser sufficient for psql's --csv output (RFC 4180-ish:
 * fields may be quoted with ", embedded " is doubled, embedded newlines
 * inside quotes are preserved).
 */
function parseCsv(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      cur.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  if (rows.length === 0) return { columns: [], rows: [] };
  const columns = rows[0];
  const dataRows = rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (let j = 0; j < columns.length; j++) obj[columns[j]] = r[j] ?? "";
    return obj;
  });
  return { columns, rows: dataRows };
}

/** Render a PsqlResult as a small ASCII table for human review. */
export function formatPsqlResult(r: PsqlResult, maxRows = 5): string {
  if (r.rows.length === 0) return "(no rows)";
  const cols = r.columns;
  const widths = cols.map((c) => c.length);
  const shown = r.rows.slice(0, maxRows);
  for (const row of shown) {
    for (let i = 0; i < cols.length; i++) {
      widths[i] = Math.max(widths[i], (row[cols[i]] ?? "").length);
    }
  }
  const fmt = (parts: string[]) =>
    parts.map((p, i) => p.padEnd(widths[i], " ")).join(" │ ");
  const out = [fmt(cols), widths.map((w) => "─".repeat(w)).join("─┼─")];
  for (const row of shown) out.push(fmt(cols.map((c) => row[c] ?? "")));
  if (r.rows.length > maxRows) out.push(`… (+${r.rows.length - maxRows} more rows)`);
  return out.join("\n");
}
