import fs from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import {
  SkillDraft,
  SkillName,
  type SkillDetail,
  type SkillFrontmatter,
  type SkillSummary,
} from "./schema";

export interface SkillWriteResult {
  action: "created" | "updated";
  skill: SkillDetail;
}

// Cap the SKILL.md read size so a runaway file can't blow up memory at
// list-time. The save path already enforces 200KB on body + small caps on
// other fields, so a healthy file is well under this. We're a bit looser on
// read because skills authored elsewhere may include large embedded data.
const MAX_SKILL_MD_BYTES = 1 * 1024 * 1024;

// Hardcoded so the writer can never drift from where the Claude Agent SDK
// scans for project skills (`<cwd>/.claude/skills/<name>/SKILL.md`). Resolved
// against process.cwd() at call time, matching the SDK's default cwd.
export function getSkillsRoot(): string {
  return path.resolve(process.cwd(), ".claude/skills");
}

export function ensureSkillsRoot(): string {
  const root = getSkillsRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function listSkills(): SkillSummary[] {
  const root = getSkillsRoot();
  if (!fs.existsSync(root)) return [];
  const rows: SkillSummary[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let detail: SkillDetail | null = null;
    try {
      detail = getSkill(entry.name);
    } catch (err) {
      console.warn(
        `[skills] failed to load "${entry.name}":`,
        err instanceof Error ? err.message : String(err)
      );
      continue;
    }
    if (detail) {
      rows.push({
        name: detail.name,
        description: detail.description,
        path: detail.path,
        updatedAt: detail.updatedAt,
        fileCount: detail.fileCount,
      });
    }
  }
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return rows;
}

export function getSkill(name: string): SkillDetail | null {
  const parsedName = SkillName.safeParse(name);
  if (!parsedName.success) return null;
  const dir = resolveSkillDir(parsedName.data);
  const dirStat = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!dirStat || !dirStat.isDirectory() || dirStat.isSymbolicLink()) return null;

  const skillPath = path.join(dir, "SKILL.md");
  const fileStat = fs.lstatSync(skillPath, { throwIfNoEntry: false });
  if (!fileStat || !fileStat.isFile() || fileStat.isSymbolicLink()) return null;
  if (fileStat.size > MAX_SKILL_MD_BYTES) {
    console.warn(
      `[skills] "${parsedName.data}" SKILL.md exceeds ${MAX_SKILL_MD_BYTES} bytes; skipping`
    );
    return null;
  }

  const markdown = fs.readFileSync(skillPath, "utf8");
  const parsed = parseSkillMarkdown(markdown);
  const description = parsed.frontmatter.description.trim();
  if (!description) {
    console.warn(
      `[skills] "${parsedName.data}" has empty description; skipping (the model needs one to disclose)`
    );
    return null;
  }
  const declaredName = parsed.frontmatter.name.trim();
  if (declaredName && declaredName !== parsedName.data) {
    console.warn(
      `[skills] "${parsedName.data}" frontmatter name "${declaredName}" disagrees with directory; using directory name`
    );
  }

  const files = collectFiles(dir);
  return {
    name: parsedName.data,
    description,
    path: dir,
    updatedAt: fileStat.mtime.toISOString(),
    fileCount: files.length,
    body: parsed.body,
    skillMarkdown: markdown,
    frontmatter: { ...parsed.frontmatter, name: parsedName.data, description },
    files,
  };
}

export function upsertSkill(input: unknown): SkillWriteResult {
  const parsed = SkillDraft.safeParse(input);
  if (!parsed.success) throw parsed.error;

  const draft = parsed.data;

  // Validate every files[] entry up front — purely in-memory, no disk writes.
  // Without this, a bad path (e.g. "../escape.md") would throw mid-write,
  // leaving a half-formed SKILL.md stub on disk.
  const validatedFiles = (draft.files ?? []).map((file) => ({
    rel: normalizeRelativeSkillPath(file.path),
    content: file.content,
  }));
  const renderedMarkdown = renderSkillMarkdown(draft);

  ensureSkillsRoot();
  const dir = resolveSkillDir(draft.name);
  const existed = fs.existsSync(path.join(dir, "SKILL.md"));
  ensureSkillDirectory(dir);

  fs.writeFileSync(path.join(dir, "SKILL.md"), renderedMarkdown, "utf8");

  for (const file of validatedFiles) {
    const full = ensureWritablePath(dir, file.rel);
    fs.writeFileSync(full, file.content, "utf8");
  }

  const skill = getSkill(draft.name);
  if (!skill) {
    throw new Error(`Failed to read saved skill "${draft.name}"`);
  }
  return { action: existed ? "updated" : "created", skill };
}

export function deleteSkill(name: string): boolean {
  const parsedName = SkillName.safeParse(name);
  if (!parsedName.success) return false;
  const dir = resolveSkillDir(parsedName.data);
  if (!fs.existsSync(dir)) return false;
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to delete symlinked skill directory: ${dir}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function formatSkillError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

function renderSkillMarkdown(draft: SkillDraft): string {
  const lines = [
    "---",
    `name: ${draft.name}`,
    `description: ${yamlScalar(draft.description)}`,
  ];

  if (draft.license) lines.push(`license: ${yamlScalar(draft.license)}`);
  if (draft.compatibility) {
    lines.push(`compatibility: ${yamlScalar(draft.compatibility)}`);
  }
  if (draft.metadata && Object.keys(draft.metadata).length > 0) {
    lines.push("metadata:");
    for (const [key, value] of Object.entries(draft.metadata)) {
      lines.push(`  ${yamlKey(key)}: ${yamlScalar(value)}`);
    }
  }
  if (draft.allowedTools) {
    lines.push(`allowed-tools: ${yamlScalar(draft.allowedTools)}`);
  }

  const body = draft.body.replace(/^\s+/, "").replace(/\s+$/, "");
  return `${lines.join("\n")}\n---\n\n${body}\n`;
}

function parseSkillMarkdown(markdown: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: { name: "", description: "" }, body: markdown };
  }

  const frontmatter: SkillFrontmatter = { name: "", description: "" };
  let inMetadata = false;
  const metadata: Record<string, string> = {};

  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const child = line.match(/^\s+([^:]+):\s*(.*)$/);
    if (inMetadata && child) {
      metadata[unquoteYamlScalar(child[1])] = unquoteYamlScalar(child[2]);
      continue;
    }

    inMetadata = false;
    const top = line.match(/^([^:]+):\s*(.*)$/);
    if (!top) continue;
    const key = top[1].trim();
    const value = unquoteYamlScalar(top[2]);
    if (key === "name") frontmatter.name = value;
    else if (key === "description") frontmatter.description = value;
    else if (key === "license") frontmatter.license = value;
    else if (key === "compatibility") frontmatter.compatibility = value;
    else if (key === "allowed-tools") frontmatter.allowedTools = value;
    else if (key === "metadata") inMetadata = true;
  }

  if (Object.keys(metadata).length > 0) frontmatter.metadata = metadata;
  return { frontmatter, body: match[2] ?? "" };
}

function resolveSkillDir(name: string): string {
  const root = path.resolve(getSkillsRoot());
  const dir = path.resolve(root, name);
  assertInside(root, dir);
  return dir;
}

function ensureSkillDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Skill path is not a writable directory: ${dir}`);
  }
}

function ensureWritablePath(skillDir: string, rel: string): string {
  const full = path.resolve(skillDir, ...rel.split("/"));
  assertInside(skillDir, full);

  let cursor = skillDir;
  const parts = rel.split("/");
  for (const part of parts.slice(0, -1)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Cannot write through non-directory path: ${cursor}`);
      }
    } else {
      fs.mkdirSync(cursor);
    }
  }

  if (fs.existsSync(full)) {
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      throw new Error(`Cannot overwrite non-file path: ${rel}`);
    }
  }
  return full;
}

function normalizeRelativeSkillPath(raw: string): string {
  const cleaned = raw.trim().replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("\0") || cleaned.startsWith("/")) {
    throw new Error(`Invalid skill file path: ${raw}`);
  }
  if (cleaned.split("/").some((part) => part === "." || part === ".." || part === "")) {
    throw new Error(`Invalid skill file path: ${raw}`);
  }
  const normalized = path.posix.normalize(cleaned);
  if (
    normalized === "." ||
    normalized === "SKILL.md" ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Invalid skill file path: ${raw}`);
  }
  if (normalized.split("/").length > 4) {
    throw new Error(`Skill file paths should stay shallow: ${raw}`);
  }
  return normalized;
}

function collectFiles(dir: string): Array<{ path: string; bytes: number }> {
  const out: Array<{ path: string; bytes: number }> = [];
  if (!fs.existsSync(dir)) return out;
  walk(dir, "");
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;

  function walk(abs: string, rel: string) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      const nextAbs = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(nextAbs, nextRel);
      } else if (entry.isFile()) {
        out.push({ path: nextRel, bytes: fs.statSync(nextAbs).size });
      }
    }
  }
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes skill root: ${candidate}`);
  }
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function yamlKey(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, trimmed.endsWith('"') ? -1 : undefined);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}
