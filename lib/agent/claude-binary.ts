import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// On Linux glibc systems pnpm sometimes installs both the gnu and musl native
// variants of the SDK (the musl package doesn't declare `libc: ["musl"]` in
// its own package.json, so pnpm can't filter it out at install time). The
// SDK's runtime resolver then picks musl, which crashes on glibc with
// "Claude Code native binary not found". We detect libc ourselves and return
// the matching prebuilt — falling back to undefined so the SDK does its
// default on platforms we don't need to override (macOS, Windows).
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

let cached: string | undefined;
let resolved = false;

export function resolveClaudeBinaryPath(): string | undefined {
  if (resolved) return cached;
  resolved = true;
  const pkg = variantPackageName();
  if (!pkg) return (cached = undefined);
  try {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`);
    const candidate = join(dirname(pkgJsonPath), "claude");
    if (existsSync(candidate)) {
      cached = candidate;
      console.log(`[claude-binary] pinned to ${candidate}`);
    }
  } catch {
    // package not installed for this platform — let the SDK try its default
  }
  return cached;
}
