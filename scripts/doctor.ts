#!/usr/bin/env -S node --experimental-strip-types
/**
 * Skill dependency doctor.
 *
 *   pnpm skills:check              # report-only: per-skill status + install commands
 *   pnpm skills:check --install    # Linux only: actually run the apt + pip installs
 *
 * The --install mode is what scripts/deploy.sh uses so each deploy
 * automatically picks up new deps introduced by new skills. macOS doesn't
 * auto-install — brewing LibreOffice (Cask, ~500MB) silently is not friendly
 * dev-machine behaviour, so on Mac the script prints the commands and exits.
 *
 * Skills not in KNOWN_SKILL_DEPS (typically user-authored) are reported as
 * "unknown" — present but not checked. Exits non-zero if anything is missing
 * locally so it can gate `scripts/deploy.sh`.
 */
import { execSync } from "node:child_process";
import { listSkills } from "@/lib/skills/files";
import { KNOWN_SKILL_DEPS } from "@/lib/skills/known-deps";

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const flagInstall = process.argv.includes("--install");

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

// Subset of allApt / allPip that's actually missing on this host. Drives
// the --install runner so we don't reinstall things that are already there.
const localMissingApt = new Set<string>();
const localMissingPip = new Set<string>();

const pythonPresent = which("python3");
const pip3Present = which("pip3");

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
      if (!pythonHas(deps.python[i])) {
        missing.push(`py:${deps.python[i]}`);
        localMissingPip.add(deps.pip[i]);
      }
    }
  } else if (deps.python.length > 0) {
    missing.push("py:python3");
  }
  for (let i = 0; i < deps.binaries.length; i++) {
    if (!which(deps.binaries[i])) {
      missing.push(`bin:${deps.binaries[i]}`);
      localMissingApt.add(deps.apt[i] ?? deps.binaries[i]);
    }
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
  console.log("All bundled skills are ready to use on this machine.\n");
  process.exit(0);
}

// --- INSTALL MODE ---
if (flagInstall) {
  if (!isLinux) {
    console.log(
      isMac
        ? "--install is Linux-only. On macOS, run the brew/pip commands below manually.\n"
        : "--install only supports Linux (Debian/Ubuntu).\n"
    );
    process.exit(1);
  }

  const aptList: string[] = [...localMissingApt];
  if (!pythonPresent) aptList.unshift("python3");
  if (localMissingPip.size > 0 && (!pip3Present || !pythonPresent)) {
    aptList.unshift("python3-pip");
  }
  const pipList = [...localMissingPip];

  if (aptList.length === 0 && pipList.length === 0) {
    console.log("Nothing to install.\n");
    process.exit(0);
  }

  console.log("Installing missing dependencies on this Linux host...\n");

  if (aptList.length > 0) {
    const cmd = `sudo apt-get install -y ${aptList.join(" ")}`;
    console.log(`$ ${cmd}\n`);
    try {
      execSync(cmd, { stdio: "inherit" });
    } catch {
      console.error("\napt-get install failed — skipping pip step.\n");
      process.exit(1);
    }
  }

  if (pipList.length > 0) {
    // --break-system-packages handles PEP 668 on Ubuntu 23.04+; on older pip
    // it's an unknown flag and pip errors loudly, which is the right signal.
    const cmd = `python3 -m pip install --user --break-system-packages ${pipList.join(" ")}`;
    console.log(`\n$ ${cmd}\n`);
    try {
      execSync(cmd, { stdio: "inherit" });
    } catch {
      console.error("\npip install failed.\n");
      process.exit(1);
    }
  }

  console.log("\nDone. Skill deps installed.\n");
  process.exit(0);
}

// --- REPORT MODE ---
if (haveDeps) {
  console.log("Install commands (full set, suitable for a fresh machine):\n");

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

  console.log(isLinux
    ? "Run `pnpm skills:install` to install these automatically.\n"
    : "Re-run `pnpm skills:check` to verify.\n"
  );
}

process.exit(1);
