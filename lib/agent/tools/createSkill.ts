import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { upsertSkill, formatSkillError } from "@/lib/skills/files";
import { SKILL_NAME_PATTERN } from "@/lib/skills/schema";

const createSkillTool = tool(
  "create_skill",
  "Create or update an Agent Skill in the agentskills.io directory format. Writes a skill-name/SKILL.md file with valid frontmatter and optional bundled resources. The user is shown a confirmation summary and must approve before this fires.",
  {
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(SKILL_NAME_PATTERN)
      .describe("Skill directory name. Lowercase letters, numbers, and hyphens only."),
    description: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .describe("What the skill does and when an agent should use it."),
    body: z
      .string()
      .min(1)
      .describe("Markdown instructions that appear after the SKILL.md frontmatter."),
    license: z.string().min(1).max(200).optional(),
    compatibility: z.string().min(1).max(500).optional(),
    metadata: z.record(z.string().min(1).max(128), z.string().max(2048)).optional(),
    allowedTools: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe("Space-separated tools for the experimental allowed-tools field."),
    files: z
      .array(
        z.object({
          path: z
            .string()
            .min(1)
            .max(240)
            .describe("Relative path under the skill root, such as references/API.md."),
          content: z.string().max(128 * 1024),
        })
      )
      .max(30)
      .optional()
      .describe(
        "Optional supporting files. Use scripts/, references/, assets/, or agents/ only when directly useful. Do not add README-style clutter."
      ),
  },
  async (args) => {
    try {
      const result = upsertSkill(args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              action: result.action,
              name: result.skill.name,
              path: result.skill.path,
              skillFile: `${result.skill.path}/SKILL.md`,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `validation_error: ${formatSkillError(err)}`,
          },
        ],
      };
    }
  }
);

export const skillBuilderServer = createSdkMcpServer({
  name: "skill_builder",
  version: "1.0.0",
  tools: [createSkillTool],
});
