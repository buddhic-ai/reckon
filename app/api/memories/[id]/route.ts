import { NextRequest } from "next/server";
import { archiveMemory, getMemory } from "@/lib/db/memories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const memory = getMemory(id);
  if (!memory) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ memory });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  const ok = archiveMemory(id, { reason });
  if (!ok) return Response.json({ error: "not found or already archived" }, { status: 404 });
  return Response.json({ ok: true });
}
