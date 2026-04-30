import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Locate the Claude Code native binary inside pnpm's per-platform native
// package. We can't use require.resolve here: this file runs inside Next.js's
// bundled server output, where Webpack/Turbopack rewrites require.resolve
// calls to return numeric module IDs instead of file paths.
//
// Instead we read pnpm's `.pnpm` store layout directly:
//   node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-<variant>@<v>/node_modules/@anthropic-ai/claude-agent-sdk-<variant>/claude
//
// On Linux glibc hosts the SDK's own runtime resolver picks the musl variant
// (which isn't fully populated on glibc), and crashes with "Claude Code
// native binary not found". We detect libc ourselves and pin the matching
// prebuilt — returning undefined on platforms we don't need to override
// (macOS, Windows) so the SDK keeps its default behaviour.
function detectLinuxLibc(): "glibc" | "musl" {
  try {
    const report = process.report?.getReport?.() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    if (report?.header?.glibcVersionRuntime) return "glibc";
  } catch {
    // fall through
  }
  return "musl";
}

function variantPackageName(): string | undefined {
  if (process.platform !== "linux") return undefined;
  const libc = detectLinuxLibc();
  if (process.arch === "x64") {
    return libc === "glibc"
      ? "@anthropic-ai/claude-agent-sdk-linux-x64"
      : "@anthropic-ai/claude-agent-sdk-linux-x64-musl";
  }
  if (process.arch === "arm64") {
    return libc === "glibc"
      ? "@anthropic-ai/claude-agent-sdk-linux-arm64"
      : "@anthropic-ai/claude-agent-sdk-linux-arm64-musl";
  }
  return undefined;
}

function findInPnpmStore(projectRoot: string, variant: string): string | undefined {
  const pnpmDir = join(projectRoot, "node_modules", ".pnpm");
  let entries: string[];
  try {
    entries = readdirSync(pnpmDir);
  } catch {
    return undefined;
  }
  // pnpm encodes "@scope/name" as "@scope+name" in the .pnpm directory.
  const prefix = variant.replace("/", "+") + "@";
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const candidate = join(pnpmDir, entry, "node_modules", variant, "claude");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

let cached: string | undefined;
let resolved = false;

export function resolveClaudeBinaryPath(): string | undefined {
  if (resolved) return cached;
  resolved = true;
  const pkg = variantPackageName();
  if (!pkg) return (cached = undefined);

  // pm2 launches the app with cwd set to the project root (ecosystem.config.cjs),
  // and `next dev` does the same. Use cwd as the project root anchor.
  const projectRoot = process.cwd();

  // Try the hoisted/top-level path first (works under npm/yarn or pnpm with
  // shamefully-hoist), then fall back to walking pnpm's .pnpm store.
  const hoisted = join(projectRoot, "node_modules", pkg, "claude");
  const candidate = existsSync(hoisted) ? hoisted : findInPnpmStore(projectRoot, pkg);

  if (candidate) {
    cached = candidate;
    console.log(`[claude-binary] pinned to ${candidate}`);
  } else {
    console.warn(`[claude-binary] could not locate ${pkg} binary under ${projectRoot}/node_modules`);
  }
  return cached;
}
