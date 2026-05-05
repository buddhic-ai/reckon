# GraphJin knowledge pack

This directory holds four JSON files prefetched at server boot from the running
GraphJin server's HTTP discovery endpoints. Read these instead of running
`graphjin cli list_tables` / `describe_table` / `query_syntax` / etc. — that
information is already on disk here.

## Files

- **`schema.json`** — full table / column / relationship inventory.
  Read this when you need to know which tables exist, what columns they have,
  what types the columns are, and which foreign keys connect tables.

- **`databases.json`** — namespaces and databases configured in GraphJin.
  Read this when you need to know which database to target if there are
  multiple. For most analytics tasks the default namespace is fine.

- **`insights.json`** — hub tables, hot relationships, duplicate warnings.
  Read this **first** when planning a multi-table query. It tells you which
  tables are central to the schema, which joins are most common, and where
  GraphJin has detected likely-duplicate or denormalised data you should treat
  carefully.

- **`syntax.json`** — query syntax cheat-sheet (operators, aggregations,
  pagination, ordering, directives, common mistakes). Read this when authoring
  a non-trivial GraphQL query — especially for aggregations (`count_*`,
  `sum()`, `avg()`) and `where:` predicates.

## Running queries

After consulting the files above, run queries via the Bash tool:

```bash
graphjin cli execute_graphql --args '{"query":"<read-only graphql>"}'
```

The CLI takes its arguments as a single JSON object via `--args`. Use
`--args-file <path>` (or `--args-file -` for stdin) when the GraphQL body is
long enough that quoting it inline gets unwieldy.

**Mutations and subscriptions are not allowed.** Any query containing the words
`mutation` or `subscription` will be denied at the tool gate.

For column details on a single table that aren't in `schema.json`, you may
also run `graphjin cli describe_table --table <name>` — but always check
`schema.json` first.
