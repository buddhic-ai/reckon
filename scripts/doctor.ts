#!/usr/bin/env -S node --experimental-strip-types
/**
 * Skill dependency doctor.
 *
 *   pnpm doctor
 *
 * Two views, one command:
 *
 *   1. Audit — per-skill OK/MISSING status for the current machine. Tells you
 *      what's broken right now.
 *   2. Install commands — copy-pasteable per-platform setup for everything
 *      every installed skill needs, regardless of what's locally present.
 *      Useful when deploying to a fresh Linux VM from a developer Mac.
 *
 * Skills not in KNOWN_SKILL_DEPS (typically user-authored) are reported as
 * "unknown" — present but not checked. Exits non-zero if anything is missing
 * locally so it can gate `scripts/deploy.sh`.
 */
import { execSync } from "node:child_process";
import { listSkills } from "@/lib/skills/files";
import { KNOWN_SKILL_DEPS } from "@/lib/skills/known-deps";

const isMac = process.platform === "darwin";

function which(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", shell: "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}

function pythonHas(mod: string): boolean {
  try {
    execSync(`python3 -c 'import ${mod}'`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

interface SkillReport {
  name: string;
  status: "ok" | "missing" | "unknown";
  missing: string[];
}

const installed = listSkills();
const reports: SkillReport[] = [];

// Aggregate dep sets from every installed-and-known skill, irrespective of
// what's locally present. These power the "install on a fresh machine" block.
const allPip = new Set<string>();
const allApt = new Set<string>();
const allBrew = new Set<string>();

const pythonPresent = which("python3");

for (const skill of installed) {
  const deps = KNOWN_SKILL_DEPS[skill.name];
  if (!deps) {
    reports.push({ name: skill.name, status: "unknown", missing: [] });
    continue;
  }
  for (const pkg of deps.pip) allPip.add(pkg);
  for (const pkg of deps.apt) allApt.add(pkg);
  for (const pkg of deps.brew) allBrew.add(pkg);

  const missing: string[] = [];
  if (pythonPresent) {
    for (let i = 0; i < deps.python.length; i++) {
      if (!pythonHas(deps.python[i])) missing.push(`py:${deps.python[i]}`);
    }
  } else if (deps.python.length > 0) {
    missing.push("py:python3");
  }
  for (const bin of deps.binaries) {
    if (!which(bin)) missing.push(`bin:${bin}`);
  }
  reports.push({
    name: skill.name,
    status: missing.length ? "missing" : "ok",
    missing,
  });
}

console.log("");
console.log("Reckon skill dependency check");
console.log("─────────────────────────────");
if (reports.length === 0) {
  console.log("  (no skills installed in .claude/skills/)\n");
  process.exit(0);
}
for (const r of reports) {
  const tag =
    r.status === "ok" ? "OK     " : r.status === "unknown" ? "?      " : "MISSING";
  const note =
    r.status === "missing" ? `  — ${r.missing.join(", ")}` :
    r.status === "unknown" ? `  — user-authored, not checked` : "";
  console.log(`  [${tag}] ${r.name}${note}`);
}
console.log("");

const allOkLocally = reports.every((r) => r.status !== "missing");
const haveDeps = allPip.size + allApt.size + allBrew.size > 0;

if (allOkLocally) {
  console.log("All bundled skills are ready to use on this machine.");
}

if (haveDeps) {
  console.log(allOkLocally
    ? "\nFor reference — to set up a fresh machine with the same skills:\n"
    : "Install commands (full set, suitable for a fresh machine):\n"
  );

  // Always show both blocks. Devs on macOS often deploy to a Linux VM and want
  // both lines visible at once; native platform first so the eye lands on the
  // immediately-runnable one.
  const linuxBlock = () => {
    const apt = ["python3", "python3-pip", ...allApt];
    console.log("  # Linux (Debian/Ubuntu)");
    console.log(`  sudo apt-get install -y ${apt.join(" ")}`);
    if (allPip.size > 0) console.log(`  pip3 install --user ${[...allPip].join(" ")}`);
    console.log("");
  };
  const macBlock = () => {
    // brew can't mix formulas and casks in one `brew install` — split them.
    const formulas: string[] = ["python"];
    const casks: string[] = [];
    for (const entry of allBrew) {
      if (entry.startsWith("--cask ")) casks.push(entry.slice("--cask ".length));
      else formulas.push(entry);
    }
    console.log("  # macOS");
    if (formulas.length > 0) console.log(`  brew install ${formulas.join(" ")}`);
    if (casks.length > 0) console.log(`  brew install --cask ${casks.join(" ")}`);
    if (allPip.size > 0) console.log(`  pip3 install ${[...allPip].join(" ")}`);
    console.log("");
  };
  if (isMac) { macBlock(); linuxBlock(); } else { linuxBlock(); macBlock(); }

  if (!allOkLocally) console.log("Re-run `pnpm doctor` to verify.\n");
}

process.exit(allOkLocally ? 0 : 1);
