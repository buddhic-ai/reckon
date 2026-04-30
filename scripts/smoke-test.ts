#!/usr/bin/env -S node --experimental-strip-types
/**
 * Smoke-test harness for the Agent platform.
 *
 * For each test in tests/<suite>.json:
 *   1. Run `groundTruthSql` directly against Postgres via psql.
 *   2. Hit POST /api/run on the dev server with `userQuery`.
 *   3. Compare the agent's final markdown answer against the `expect`
 *      substrings (case-insensitive).
 *
 * The dev server must already be running on AGENT_BASE_URL (default
 * http://127.0.0.1:3000). The harness creates / reuses a "Smoke Test
 * Analyst" workflow it owns.
 *
 * Usage:
 *   pnpm smoke
 *   pnpm smoke -- --filter 14-top-salesperson      # only run matching tests
 *   pnpm smoke -- --bail                           # stop on first failure
 *   pnpm smoke -- --no-agent                       # only print SQL ground truth
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runPsql, formatPsqlResult } from "@/lib/test-helpers/psql";
import {
  ensureAnalystWorkflow,
  runAgentViaHttp,
} from "@/lib/test-helpers/agent";
import type { RunEvent } from "@/lib/runtime/event-types";

interface TestCase {
  id: string;
  name: string;
  userQuery: string;
  groundTruthSql: string;
  expect: string[];
  notes?: string;
}

interface CaseResult {
  test: TestCase;
  sqlOutput: string;
  agentOutput: string;
  durationMs: number;
  passed: boolean;
  missing: string[];
  agentError?: string;
  sqlError?: string;
}

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : "";
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[,$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function checkExpect(answer: string, expect: string[]): string[] {
  const normAns = normalize(answer);
  return expect.filter((e) => !normAns.includes(normalize(e)));
}

/**
 * Walk every `surface` event and dump every KPI value, Table cell, Chart data
 * point, and Callout text into a flat string so substring assertions still
 * pass even when the agent pushes its findings into a UI surface instead of
 * the markdown reply.
 */
function flattenSurfacesToText(events: RunEvent[]): string {
  const parts: string[] = [];
  for (const ev of events) {
    if (ev.type !== "surface") continue;
    for (const m of ev.messages) {
      const m2 = m as unknown as Record<string, unknown>;
      const upd = m2.updateComponents as { components?: unknown[] } | undefined;
      const dm = m2.updateDataModel as { value?: unknown } | undefined;
      if (Array.isArray(upd?.components)) {
        for (const c of upd!.components as Record<string, unknown>[]) {
          collectStrings(c, parts);
        }
      }
      if (dm && "value" in dm) collectStrings(dm.value, parts);
    }
  }
  return parts.join(" ");
}

function collectStrings(v: unknown, out: string[]): void {
  if (v == null) return;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    out.push(String(v));
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) collectStrings(item, out);
    return;
  }
  if (typeof v === "object") {
    for (const value of Object.values(v as Record<string, unknown>)) {
      collectStrings(value, out);
    }
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

const COLOR_RESET = "\x1b[0m";
const COLOR_GREEN = "\x1b[32m";
const COLOR_RED = "\x1b[31m";
const COLOR_DIM = "\x1b[2m";
const COLOR_YELLOW = "\x1b[33m";

async function main() {
  loadEnv();

  const baseUrl = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:3000";
  const dbUrl = process.env.ADVENTUREWORKS_DB_URL ?? "";
  if (!dbUrl) {
    console.error("ADVENTUREWORKS_DB_URL is not set in .env.local");
    process.exit(2);
  }

  const suite = arg("suite") || "adventureworks";
  const filter = arg("filter");
  const bail = flag("bail");
  const skipAgent = flag("no-agent");
  const verbose = flag("verbose");

  const testsPath = path.join(process.cwd(), "tests", `${suite}.json`);
  const tests: TestCase[] = JSON.parse(fs.readFileSync(testsPath, "utf8"));
  const runSet = filter ? tests.filter((t) => t.id.includes(filter) || t.name.toLowerCase().includes(filter.toLowerCase())) : tests;

  let analystWorkflowId = "";
  if (!skipAgent) {
    try {
      analystWorkflowId = await ensureAnalystWorkflow(baseUrl);
    } catch (err) {
      console.error(`${COLOR_RED}Failed to set up analyst workflow:${COLOR_RESET} ${err instanceof Error ? err.message : err}`);
      console.error(`Is the dev server running at ${baseUrl}? Try \`pnpm dev\` in another shell.`);
      process.exit(2);
    }
  }

  console.log(`${COLOR_DIM}suite=${suite}  baseUrl=${baseUrl}  ${runSet.length} test(s)${COLOR_RESET}\n`);

  const results: CaseResult[] = [];
  let pass = 0;
  let fail = 0;

  for (const t of runSet) {
    process.stdout.write(`${pad(t.id, 32)} ${pad(t.name, 50)} `);

    // Run SQL ground truth.
    const sqlOutcome = await runPsql(dbUrl, t.groundTruthSql);
    let sqlOutput = "";
    let sqlError: string | undefined;
    if (sqlOutcome.ok) {
      sqlOutput = formatPsqlResult(sqlOutcome, 5);
    } else {
      sqlError = sqlOutcome.error;
      sqlOutput = sqlOutcome.error;
    }

    let agentOutput = "";
    let surfaceCorpus = "";
    let agentError: string | undefined;
    let durationMs = 0;
    if (!skipAgent) {
      const r = await runAgentViaHttp({
        baseUrl,
        workflowId: analystWorkflowId,
        initialUserMessage: t.userQuery,
        timeoutMs: 240_000,
      });
      agentOutput = r.finalText;
      surfaceCorpus = flattenSurfacesToText(r.events);
      agentError = r.errorMessage;
      durationMs = r.durationMs;
    }

    // Substring corpus: the markdown reply PLUS every value the agent pushed
    // into a surface card. The agent passes if the expected fragments appear
    // anywhere across both.
    const matchCorpus = `${agentOutput}\n${surfaceCorpus}`;
    const missing = skipAgent ? [] : checkExpect(matchCorpus, t.expect);
    const passed = !skipAgent && !agentError && missing.length === 0;

    results.push({
      test: t,
      sqlOutput,
      agentOutput,
      durationMs,
      passed,
      missing,
      agentError,
      sqlError,
    });

    if (skipAgent) {
      console.log(`${COLOR_YELLOW}[sql-only]${COLOR_RESET}  ${(durationMs / 1000).toFixed(1)}s`);
    } else if (passed) {
      console.log(`${COLOR_GREEN}PASS${COLOR_RESET}  ${(durationMs / 1000).toFixed(1)}s`);
      pass++;
    } else {
      console.log(`${COLOR_RED}FAIL${COLOR_RESET}  ${(durationMs / 1000).toFixed(1)}s`);
      fail++;
      if (bail) break;
    }
  }

  // Detail report.
  console.log("\n=== detail ===\n");
  for (const r of results) {
    const tag = r.passed
      ? `${COLOR_GREEN}PASS${COLOR_RESET}`
      : skipAgent
      ? `${COLOR_YELLOW}SQL${COLOR_RESET}`
      : `${COLOR_RED}FAIL${COLOR_RESET}`;
    console.log(`${tag}  ${r.test.id}  ${r.test.name}`);
    if (r.test.notes) console.log(`  ${COLOR_DIM}note:${COLOR_RESET} ${r.test.notes}`);
    console.log(`  ${COLOR_DIM}user query:${COLOR_RESET} ${r.test.userQuery}`);
    if (r.sqlError) {
      console.log(`  ${COLOR_DIM}sql error:${COLOR_RESET} ${COLOR_RED}${r.sqlError}${COLOR_RESET}`);
    } else {
      console.log(`  ${COLOR_DIM}sql ground truth:${COLOR_RESET}`);
      for (const line of r.sqlOutput.split("\n")) console.log(`    ${line}`);
    }
    if (!skipAgent) {
      if (r.agentError) {
        console.log(`  ${COLOR_DIM}agent error:${COLOR_RESET} ${COLOR_RED}${r.agentError}${COLOR_RESET}`);
      }
      console.log(`  ${COLOR_DIM}agent answer:${COLOR_RESET}`);
      const ans = r.agentOutput || "(empty)";
      for (const line of ans.split("\n").slice(0, 8))
        console.log(`    ${line}`);
      if (ans.split("\n").length > 8) console.log(`    …`);
      if (r.missing.length > 0) {
        console.log(`  ${COLOR_DIM}missing expected substrings:${COLOR_RESET} ${r.missing.map((s) => `"${s}"`).join(", ")}`);
      }
    }
    if (verbose && !skipAgent) {
      console.log(`  ${COLOR_DIM}duration:${COLOR_RESET} ${r.durationMs}ms`);
    }
    console.log("");
  }

  if (skipAgent) {
    console.log(`\n${COLOR_DIM}--no-agent: ran SQL ground truth only.${COLOR_RESET}`);
    process.exit(0);
  }

  console.log(
    `\n${pass} ${COLOR_GREEN}passed${COLOR_RESET} · ${fail} ${COLOR_RED}failed${COLOR_RESET} · ${results.length} total`
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`${COLOR_RED}smoke harness crashed:${COLOR_RESET}`, err);
  process.exit(2);
});
