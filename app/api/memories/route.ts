import { NextRequest } from "next/server";
import { listAllMemories } from "@/lib/db/memories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const memories = listAllMemories({ includeArchived });
  return Response.json({ memories });
}
