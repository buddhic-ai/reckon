import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";

export const runtime = "nodejs";

const ALLOWED_PREFIXES = [
  path.join("data", "reports") + path.sep,
  path.join("data", "uploads") + path.sep,
];

const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// Browsers can't preview these — force download instead of inline display.
const FORCE_DOWNLOAD = new Set([".docx", ".xlsx", ".pptx"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: parts } = await params;
  if (!parts || parts.length === 0) {
    return new Response("not found", { status: 404 });
  }

  const root = process.cwd();
  const rel = path.join(...parts);
  const abs = path.resolve(root, rel);

  if (abs !== path.normalize(abs) || !abs.startsWith(root + path.sep)) {
    return new Response("not found", { status: 404 });
  }
  const relFromRoot = path.relative(root, abs);
  if (!ALLOWED_PREFIXES.some((p) => relFromRoot.startsWith(p))) {
    return new Response("not found", { status: 404 });
  }

  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isFile()) {
    return new Response("not found", { status: 404 });
  }

  const buf = await fs.readFile(abs);
  const ext = path.extname(abs).toLowerCase();
  const type = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const filename = path.basename(abs);
  const disposition = FORCE_DOWNLOAD.has(ext) ? "attachment" : "inline";

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Content-Disposition": `${disposition}; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
