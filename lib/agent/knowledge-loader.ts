import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

const SECTIONS = [
  { section: "schema", file: "schema.json" },
  { section: "namespaces", file: "databases.json" },
  { section: "insights", file: "insights.json" },
  { section: "syntax", file: "syntax.json" },
] as const;

const KNOWLEDGE_DIR = path.join(process.cwd(), "lib", "agent", "knowledge");

function discoveryURL(section: string): string {
  return `${env.graphjinBaseUrl()}/api/v1/discovery/${section}`;
}

async function fetchDiscoveryJSON(section: string, label: string): Promise<string> {
  const url = discoveryURL(section);
  const retries = env.discoveryRetries();
  const timeoutMs = env.discoveryTimeoutMs();
  const token = env.graphjinToken();

  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers, signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      return JSON.stringify(await res.json(), null, 2);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[discovery] ${label} attempt ${attempt}/${retries} failed: ${msg}`
      );
      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * 2 ** (attempt - 1))
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `discovery ${label} fetch failed after ${retries} attempts: ${msg}`
  );
}

export interface PrefetchResult {
  ok: boolean;
  files: { file: string; bytes: number }[];
  error?: string;
}

/**
 * Fetch the four GraphJin discovery JSON blobs and write them under
 * lib/agent/knowledge/. Called once at server boot from instrumentation.ts.
 *
 * If GraphJin is unreachable, returns ok:false so the caller can surface a
 * degraded health state without preventing the rest of the app from booting.
 */
export async function prefetchKnowledge(): Promise<PrefetchResult> {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  try {
    const results = await Promise.all(
      SECTIONS.map((s) => fetchDiscoveryJSON(s.section, s.section))
    );
    const out: { file: string; bytes: number }[] = [];
    for (let i = 0; i < SECTIONS.length; i++) {
      const file = SECTIONS[i].file;
      const json = results[i];
      await fs.writeFile(path.join(KNOWLEDGE_DIR, file), json, "utf8");
      out.push({ file, bytes: json.length });
    }
    console.error(
      `[knowledge] prefetched: ${out.map((o) => `${o.file}=${o.bytes}B`).join(" ")}`
    );
    return { ok: true, files: out };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[knowledge] prefetch failed: ${msg}`);
    return { ok: false, files: [], error: msg };
  }
}

/**
 * Cheap presence check — used by /api/health and the home banner.
 * Returns the list of knowledge files actually on disk.
 */
export async function knowledgeStatus(): Promise<{ present: string[]; missing: string[] }> {
  const present: string[] = [];
  const missing: string[] = [];
  for (const s of SECTIONS) {
    try {
      await fs.access(path.join(KNOWLEDGE_DIR, s.file));
      present.push(s.file);
    } catch {
      missing.push(s.file);
    }
  }
  return { present, missing };
}
