/**
 * Upload an array of File objects to /api/upload, returning the server-side
 * relative paths (e.g. "data/uploads/<chatId>/<name>"). Used by the chat
 * pages to ferry browser File objects to disk where the agent's Read tool
 * can pick them up.
 */
export interface UploadedFile {
  path: string;
  name: string;
  size: number;
}

export async function uploadFiles(
  chatId: string,
  files: File[]
): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("chatId", chatId);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) continue;
    const data = (await res.json()) as UploadedFile;
    out.push(data);
  }
  return out;
}

/**
 * Take a user-typed message and the uploaded file paths, return a single
 * combined message the agent will see. The path list is appended in a way
 * the model treats as natural attachment context.
 */
export function joinMessageWithAttachments(
  text: string,
  files: UploadedFile[]
): string {
  if (files.length === 0) return text;
  const lines = files
    .map((f) => `- ${f.path}  (${f.name}, ${(f.size / 1024).toFixed(0)} KB)`)
    .join("\n");
  const prefix = text.trim() ? text.trim() + "\n\n" : "";
  return `${prefix}I've attached ${files.length === 1 ? "a file" : "files"}:\n${lines}`;
}
