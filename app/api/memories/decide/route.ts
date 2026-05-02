import { NextRequest } from "next/server";
import {
  acceptPendingMemory,
  declinePendingMemory,
} from "@/lib/db/pendingMemories";
import { MEMORY_SCOPES, type MemoryScope } from "@/lib/db/memories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/memories/decide
 *
 * Body:
 *   { id: string, action: "accept", text?, scope?, scopeId?, pinned? }
 *   { id: string, action: "decline", reason? }
 *
 * Accept writes a row to `memories` and marks the pending row accepted.
 * Decline marks the pending row declined; nothing is added to memories.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  const action = body?.action;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  try {
    if (action === "accept") {
      const scope =
        typeof body?.scope === "string" && MEMORY_SCOPES.includes(body.scope as MemoryScope)
          ? (body.scope as MemoryScope)
          : undefined;
      const result = acceptPendingMemory({
        id,
        text: typeof body?.text === "string" ? body.text : undefined,
        scope,
        scopeId: typeof body?.scopeId === "string" ? body.scopeId : undefined,
        pinned: typeof body?.pinned === "boolean" ? body.pinned : undefined,
      });
      return Response.json({ ok: true, ...result });
    }
    if (action === "decline") {
      const reason = typeof body?.reason === "string" ? body.reason : undefined;
      const pending = declinePendingMemory(id, reason);
      return Response.json({ ok: true, pending });
    }
    return Response.json({ error: "action must be accept or decline" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}
