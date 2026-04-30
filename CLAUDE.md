@AGENTS.md

# Agent — project conventions

A generic Claude-Code-style agent platform with a workflow builder. Two screens
share one streaming agent runtime:

- `/builder` — a meta-agent that interviews a non-technical user (CEO/CFO) and
  saves the result as a workflow JSON in SQLite via the in-process
  `mcp__workflow_builder__create_workflow` tool.
- `/run/[workflowId]` — runs a saved workflow with the same SDK runtime,
  parameterised by the workflow's `systemPromptOverlay`, `steps[]`, and
  `triggers`. Scheduled runs go through the same path in `mode: "headless"`.

## Workflow shape (prose, not DAG)

A workflow is **not** a graph. It's a system-prompt overlay plus an ordered
list of plain-English step descriptions plus a flat `allowedTools` list. The
agent reads the steps as instructions; flexibility lives in Claude. Don't add
DAG nodes, conditional branching syntax, or visual edges. See
`lib/workflow/schema.ts`.

## Tool surface — read-only and Bash-driven

Workflows inherit a single `DEFAULT_ALLOWED_TOOLS` constant:
`Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, AskUserQuestion`.
There is no per-workflow tool customisation in v1 (the field exists on the
schema for v2). The meta-agent does **not** classify workflows or pick
allowlists.

DB access is exclusively via `graphjin cli` invoked through the Bash tool.
There is no GraphJin MCP server and no custom GraphJin MCP wrapper. The
`canUseTool` gate (`lib/agent/tool-defaults.ts → inspectBashForGraphjinMutations`)
inspects every Bash invocation and denies any GraphJin write — `mutation` /
`subscription` queries plus direct write subcommands like `save_workflow`,
`apply_schema_changes`, etc.

## GraphJin knowledge pack

`lib/agent/knowledge/` contains four JSON files (`schema`, `databases`,
`insights`, `syntax`) prefetched at server boot from GraphJin's HTTP discovery
endpoints (`GET ${GRAPHJIN_BASE_URL}/discover/<section>`). Both agents `Read`
these instead of running discovery commands at conversation time. Plus
`INDEX.md` (committed) tells the agent which file to consult for what.

The four JSON files are gitignored — they're regenerated every server boot.
There is **no** `pnpm refresh-knowledge` command in v1. Restart the process to
refetch.

## Headless runs

Scheduled (cron) runs invoke `runWorkflow({ ..., mode: "headless" })`. In this
mode `askUser` raises `HeadlessNeedsInputError` on first call, which the runner
catches and surfaces as `status: "needs_input"`. The run shows up in `/runs`
with that status and the user re-runs manually. The headless path appends
events to `run_events` directly (no SSE consumer).

## Run registry

`lib/runtime/run-registry.ts` is keyed on `runId` and stashed on `globalThis`
for HMR-safe sharing between API routes. It's a port of the RO project's
registry **stripped** of the entity-resolution ledger and a2ui state — do not
reintroduce them here. This project has no entity-confirmation gate.

## Persistence

SQLite via `better-sqlite3` at `data/agent.db`. Three tables: `workflows`,
`runs`, `run_events`. `run_events` is append-only and powers replay at
`/runs/[runId]`. The DB handle is stashed on `globalThis` (see RO's
`audit.ts` pattern).

## Scheduling

In-process `node-cron` jobs. Booted by `instrumentation.ts` → `initScheduler()`
which reads all workflows with `triggers.cron` and registers them. CRUD on
workflows re-registers (`scheduleWorkflow`/`unscheduleWorkflow`). Default
timezone `UTC`; the meta-agent should ask the user for tz when setting cron.

## Don't

- Don't add a GraphJin MCP server. Bash + `graphjin cli` is the contract.
- Don't add per-workflow tool gating or 4-pattern allowlist menus to the meta-agent.
- Don't write markdown docs from the GraphJin repo into `lib/agent/knowledge/` — only the four JSON discovery dumps belong there.
- Don't reintroduce the resolution-ledger or a2ui from the RO project.
- Don't bind the dev server to `0.0.0.0`. v1 is `127.0.0.1` only (no auth).
