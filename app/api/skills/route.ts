import { NextRequest } from "next/server";
import { formatSkillError, listSkills, upsertSkill } from "@/lib/skills/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ skills: listSkills() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const result = upsertSkill(body);
    return Response.json({ ok: true, action: result.action, skill: result.skill });
  } catch (err) {
    return Response.json(
      { error: "validation_error", message: formatSkillError(err) },
      { status: 400 }
    );
  }
}
