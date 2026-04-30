import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const KNOWLEDGE_DIR = path.join(process.cwd(), "lib/agent/knowledge");
const INSIGHTS_PATH = path.join(KNOWLEDGE_DIR, "insights.json");

/**
 * Stable identifier for the connected DB's knowledge pack. Changes whenever
 * the database name, schema list, or query-template inventory shifts — which
 * is what triggers a chip regeneration.
 *
 * Returns null if the insights file isn't on disk yet (first boot before
 * discovery completes).
 */
export function computeKnowledgeFingerprint(): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(INSIGHTS_PATH, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const seed = extractFingerprintSeed(parsed);
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

function extractFingerprintSeed(insights: unknown): string {
  const obj = (insights ?? {}) as Record<string, unknown>;
  const database = typeof obj.database === "string" ? obj.database : "";
  const overview = (obj.database_overview as Record<string, unknown> | undefined) ?? {};
  const totalTables = typeof overview.total_tables === "number" ? overview.total_tables : 0;
  const schemas = Array.isArray(overview.schemas)
    ? (overview.schemas as Array<Record<string, unknown>>).map((s) => String(s.name ?? "")).sort()
    : [];
  const templates = Array.isArray(obj.query_templates)
    ? (obj.query_templates as Array<Record<string, unknown>>)
        .map((t) => String(t.name ?? ""))
        .sort()
    : [];
  return JSON.stringify({ database, totalTables, schemas, templates });
}
