import { NextRequest } from "next/server";
import { deleteSkill, getSkill } from "@/lib/skills/files";
import { SkillName } from "@/lib/skills/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ skillName: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { skillName } = await params;
  const parsedName = SkillName.safeParse(skillName);
  if (!parsedName.success) {
    return Response.json({ error: "invalid skill name" }, { status: 400 });
  }
  const skill = getSkill(parsedName.data);
  if (!skill) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ skill });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { skillName } = await params;
  const parsedName = SkillName.safeParse(skillName);
  if (!parsedName.success) {
    return Response.json({ error: "invalid skill name" }, { status: 400 });
  }
  try {
    deleteSkill(parsedName.data);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}
