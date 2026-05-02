import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { getChat } from "@/lib/db/chats";

export const runtime = "nodejs";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_NAME_LEN = 200;

/**
 * Multipart upload. Body: file=<File>, chatId=<string>. Files land at
 * data/uploads/<chatId>/<safe-filename>. The agent reads them via the Read
 * tool — no new tool plumbing needed.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected multipart/form-data" }, { status: 400 });
  const file = form.get("file");
  const chatId = form.get("chatId");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing file" }, { status: 400 });
  }
  if (typeof chatId !== "string" || !chatId) {
    return Response.json({ error: "missing chatId" }, { status: 400 });
  }
  if (!getChat(chatId)) {
    return Response.json({ error: "chat not found" }, { status: 404 });
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: `file too large (max ${MAX_SIZE} bytes)` }, { status: 413 });
  }
  if (file.type.startsWith("image/")) {
    return Response.json({ error: "image uploads are not supported" }, { status: 415 });
  }

  const safeName = sanitiseFilename(file.name);
  const relDir = path.posix.join("data", "uploads", chatId);
  const absDir = path.join(process.cwd(), relDir);
  await fs.mkdir(absDir, { recursive: true });
  const dest = path.join(absDir, safeName);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(dest, buf);
  return Response.json({
    path: path.posix.join(relDir, safeName),
    name: safeName,
    size: file.size,
  });
}

function sanitiseFilename(name: string): string {
  // Strip directory parts, replace anything not safe.
  const base = name.split("/").pop()!.split("\\").pop()!;
  return base
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, MAX_NAME_LEN);
}
