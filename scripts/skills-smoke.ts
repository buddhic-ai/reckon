#!/usr/bin/env -S node --experimental-strip-types
/**
 * Temp-dir smoke test for the skills layer.
 *
 * Chdirs into a fresh tmp directory so that getSkillsRoot() resolves there
 * (it's hardcoded to `<cwd>/.claude/skills`), then exercises upsertSkill,
 * listSkills, getSkill, and deleteSkill. Validates frontmatter rendering,
 * supporting-file writes, and the path-traversal rejections.
 *
 * Usage:
 *   pnpm exec tsx scripts/skills-smoke.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const originalCwd = process.cwd();
const tmpCwd = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "reckon-skillssmoke-"))
);
process.chdir(tmpCwd);
const tmpDir = path.join(tmpCwd, ".claude/skills");

import {
  deleteSkill,
  getSkill,
  getSkillsRoot,
  listSkills,
  upsertSkill,
} from "@/lib/skills/files";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

function main(): number {
  console.log("== skills smoke ==");
  console.log(`skills root: ${tmpDir}\n`);

  check("getSkillsRoot points at the temp dir", getSkillsRoot() === tmpDir);
  check("empty list before any saves", listSkills().length === 0);

  // 1. Create a skill with one resource file.
  const created = upsertSkill({
    name: "weekly-revenue-report",
    description: "Render a weekly revenue summary KPI block.",
    body: "Steps:\n1. Query last 7 days.\n2. Render KPI cards via present().",
    files: [
      {
        path: "references/columns.md",
        content: "# Columns\n- order_total\n- order_date\n",
      },
    ],
  });
  check("create returns 'created'", created.action === "created");
  check(
    "SKILL.md exists on disk",
    fs.existsSync(path.join(tmpDir, "weekly-revenue-report", "SKILL.md"))
  );
  check(
    "supporting file written under references/",
    fs.existsSync(
      path.join(tmpDir, "weekly-revenue-report", "references", "columns.md")
    )
  );

  const md = fs.readFileSync(
    path.join(tmpDir, "weekly-revenue-report", "SKILL.md"),
    "utf8"
  );
  check("frontmatter has name", md.includes(`name: weekly-revenue-report`));
  check(
    "frontmatter description is double-quoted",
    md.includes(`description: "Render a weekly revenue summary KPI block."`)
  );
  check("body follows the frontmatter delimiter", md.includes("\n---\n\nSteps:"));

  // 2. List + read back.
  const list = listSkills();
  check("list has the new skill", list.length === 1 && list[0].name === "weekly-revenue-report");
  const detail = getSkill("weekly-revenue-report");
  check("getSkill parses description", detail?.description === "Render a weekly revenue summary KPI block.");
  check("getSkill counts the supporting file", detail?.fileCount === 2);

  // 3. Update existing skill.
  const updated = upsertSkill({
    name: "weekly-revenue-report",
    description: "Updated description.",
    body: "Updated body content.",
  });
  check("second upsert returns 'updated'", updated.action === "updated");
  const detail2 = getSkill("weekly-revenue-report");
  check("description was overwritten", detail2?.description === "Updated description.");
  check("body was overwritten", detail2?.body.trim().startsWith("Updated body") === true);

  // 4. Path-traversal rejection.
  let traversalRejected = false;
  try {
    upsertSkill({
      name: "evil",
      description: "tries to escape root",
      body: "x",
      files: [{ path: "../escaped.md", content: "no" }],
    });
  } catch {
    traversalRejected = true;
  }
  check("path-traversal file path is rejected", traversalRejected);
  check(
    "no escaped file written above the skills root",
    !fs.existsSync(path.join(tmpDir, "..", "escaped.md"))
  );

  // 5. Reject overwriting SKILL.md via the files[] array.
  let skillMdRejected = false;
  try {
    upsertSkill({
      name: "weekly-revenue-report",
      description: "x",
      body: "x",
      files: [{ path: "SKILL.md", content: "no" }],
    });
  } catch {
    skillMdRejected = true;
  }
  check("files[] cannot target SKILL.md directly", skillMdRejected);

  // 6. Invalid skill names.
  let badNameRejected = false;
  try {
    upsertSkill({
      name: "Bad Name",
      description: "x",
      body: "x",
    });
  } catch {
    badNameRejected = true;
  }
  check("invalid skill name (uppercase + space) is rejected", badNameRejected);

  // 7. Delete.
  const deleted = deleteSkill("weekly-revenue-report");
  check("deleteSkill returns true", deleted === true);
  check(
    "skill directory removed",
    !fs.existsSync(path.join(tmpDir, "weekly-revenue-report"))
  );
  check("listSkills now empty", listSkills().length === 0);
  check("deleting a missing skill returns false", deleteSkill("does-not-exist") === false);

  console.log("");
  console.log(`${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

const code = main();
process.chdir(originalCwd);
try {
  fs.rmSync(tmpCwd, { recursive: true, force: true });
} catch {
  // best effort
}
process.exit(code);
