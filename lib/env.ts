import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),
  anthropicModel: () => optional("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
  // turbopackIgnore: SQLite path resolution at runtime — Turbopack's NFT
  // tracer otherwise treats the dynamic env-var argument as a candidate
  // require root and pulls the whole project into the bundle.
  dbPath: () => path.resolve(/*turbopackIgnore: true*/ process.cwd(), optional("AGENT_DB_PATH", "./data/agent.db")),
  costCapUsd: () => num("AGENT_COST_CAP_USD", 5),
  autoMemoryMode: (): "off" | "propose" | "on" => {
    const v = (process.env.AGENT_AUTO_MEMORY ?? "on").trim().toLowerCase();
    return v === "off" || v === "propose" ? v : "on";
  },
  autoMemoryClassifierModel: () =>
    optional("AGENT_AUTO_MEMORY_MODEL", "claude-haiku-4-5-20251001"),
  graphjinBaseUrl: () => optional("GRAPHJIN_BASE_URL", "http://localhost:8080").replace(/\/+$/, ""),
  graphjinToken: () => process.env.GRAPHJIN_TOKEN ?? "",
  discoveryTimeoutMs: () => num("DISCOVERY_TIMEOUT_MS", 10_000),
  discoveryRetries: () => num("DISCOVERY_RETRIES", 3),
  defaultTimezone: () => optional("DEFAULT_TIMEZONE", "UTC"),
};
