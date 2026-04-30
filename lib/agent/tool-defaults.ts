/**
 * The default set of SDK tools every workflow inherits in v1. Workflows that
 * omit `allowedTools` get exactly this list. (Per-workflow customisation is a
 * v2 concern.)
 *
 * Note: `graphjin cli` is not a tool name — it's a subcommand the agent runs
 * via the Bash tool. The runner system prompt enumerates it as a first-class
 * capability under Bash, and `inspectBashForGraphjinMutations` below enforces
 * the read-only contract on every Bash invocation.
 */
export const DEFAULT_ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "mcp__ui__*",
] as const;

/**
 * Tools we always deny — they cause hangs (Monitor blocks until timeout
 * because the SDK can't consume its async event stream), pollute scope
 * (Task*, Skill, ToolSearch), or are duplicates that confuse the model.
 */
export const FIXED_DENY = [
  "Monitor",
  "Task",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "TaskStop",
  "Skill",
  "ToolSearch",
  "NotebookEdit",
  "mcp__chrome-devtools__*",
] as const;

/** Allow-list for the meta-agent. It must NOT have Bash, Write, or Edit. */
export const META_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "mcp__workflow_builder__*",
] as const;

/** Match a tool name against an exact name or trailing-`*` wildcard pattern. */
export function matches(name: string, pattern: string): boolean {
  if (pattern.endsWith("*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return name === pattern;
}

/**
 * Inspect a Bash command for GraphJin write operations and return a deny
 * reason, or null if the command is allowed.
 *
 * Rules:
 *   - Non-graphjin commands → null (the gate doesn't care).
 *   - `graphjin cli execute_graphql` / `execute_saved_query` / `execute_workflow`
 *     with a query string containing `mutation` or `subscription` → deny.
 *   - Direct write subcommands (save_workflow, update_current_config,
 *     apply_schema_changes, reload_schema, apply_database_setup,
 *     preview_schema_changes) → deny.
 */
export function inspectBashForGraphjinMutations(cmd: string): string | null {
  if (!cmd.includes("graphjin")) return null;

  const writeSubcommands = [
    "save_workflow",
    "update_current_config",
    "apply_schema_changes",
    "reload_schema",
    "apply_database_setup",
    "preview_schema_changes",
  ];
  for (const sub of writeSubcommands) {
    const re = new RegExp(`\\bgraphjin\\s+(?:cli\\s+)?${sub}\\b`);
    if (re.test(cmd)) {
      return `This workflow is read-only. \`graphjin cli ${sub}\` mutates server state and is not allowed.`;
    }
  }

  const isExecutor = /\bgraphjin\s+(?:cli\s+)?(?:execute_graphql|execute_saved_query|execute_workflow)\b/.test(
    cmd
  );
  if (isExecutor && /\b(mutation|subscription)\b/i.test(cmd)) {
    return "This workflow is read-only. GraphJin mutations and subscriptions are not permitted.";
  }

  return null;
}
