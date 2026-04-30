import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const projectRequire = createRequire(import.meta.url);

// pnpm symlinks the per-platform native variant into the SDK's *own*
// node_modules, not the project root. Anchor module resolution at the SDK's
// entry point so `require.resolve("@anthropic-ai/claude-agent-sdk-<variant>")`
// can follow that symlink. Resolving from the project root returns
// MODULE_NOT_FOUND under pnpm's isolated layout.
//
// On Linux glibc hosts the SDK's own runtime resolver picks the musl variant
// (which isn't symlinked into the SDK's node_modules on glibc), and crashes
// with "Claude Code native binary not found". We detect libc ourselves and
// pin the matching prebuilt — falling back to undefined so the SDK does its
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
    const sdkEntry = projectRequire.resolve("@anthropic-ai/claude-agent-sdk");
    const sdkRequire = createRequire(sdkEntry);
    const pkgJsonPath = sdkRequire.resolve(`${pkg}/package.json`);
    const candidate = join(dirname(pkgJsonPath), "claude");
    if (existsSync(candidate)) {
      cached = candidate;
      console.log(`[claude-binary] pinned to ${candidate}`);
    } else {
      console.warn(`[claude-binary] ${pkg} resolved but binary missing at ${candidate}`);
    }
  } catch (err) {
    console.warn(`[claude-binary] could not resolve ${pkg}:`, (err as Error).message);
  }
  return cached;
}
