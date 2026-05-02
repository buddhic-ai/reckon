import { z } from "zod";

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SkillName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    SKILL_NAME_PATTERN,
    "use lowercase letters, numbers, and single hyphens only"
  );

export const SkillFile = z.object({
  path: z.string().trim().min(1).max(240),
  content: z.string().max(128 * 1024),
});
export type SkillFile = z.infer<typeof SkillFile>;

export const SkillDraft = z.object({
  name: SkillName,
  description: z.string().trim().min(1).max(1024),
  body: z
    .string()
    .max(200 * 1024)
    .refine((v) => v.trim().length > 0, "body is required"),
  license: z.string().trim().min(1).max(200).optional(),
  compatibility: z.string().trim().min(1).max(500).optional(),
  metadata: z
    .record(z.string().trim().min(1).max(128), z.string().max(2048))
    .optional(),
  allowedTools: z.string().trim().min(1).max(1000).optional(),
  files: z.array(SkillFile).max(30).optional(),
});
export type SkillDraft = z.infer<typeof SkillDraft>;

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
  updatedAt: string;
  fileCount: number;
}

export interface SkillDetail extends SkillSummary {
  body: string;
  skillMarkdown: string;
  frontmatter: SkillFrontmatter;
  files: Array<{ path: string; bytes: number }>;
}

export function normalizeSkillName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
}
