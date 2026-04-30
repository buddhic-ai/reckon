import { getDb } from "./client";
import { parseWorkflow } from "@/lib/workflow/validate";
import type { Workflow } from "@/lib/workflow/schema";

interface Row {
  id: string;
  name: string;
  description: string;
  json: string;
  created_at: string;
  updated_at: string;
}

function rowToWorkflow(row: Row): Workflow {
  return parseWorkflow(JSON.parse(row.json));
}

export function insertWorkflow(wf: Workflow): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO workflows (id, name, description, json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(wf.id, wf.name, wf.description, JSON.stringify(wf), wf.createdAt, wf.updatedAt);
}

export function updateWorkflow(wf: Workflow): void {
  const db = getDb();
  db.prepare(
    `UPDATE workflows
     SET name = ?, description = ?, json = ?, updated_at = ?
     WHERE id = ?`
  ).run(wf.name, wf.description, JSON.stringify(wf), wf.updatedAt, wf.id);
}

export function getWorkflowByName(name: string): Workflow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM workflows WHERE name = ?").get(name) as Row | undefined;
  return row ? rowToWorkflow(row) : null;
}

export function getWorkflow(id: string): Workflow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToWorkflow(row) : null;
}

export function listWorkflows(): Workflow[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM workflows ORDER BY updated_at DESC")
    .all() as Row[];
  return rows.map(rowToWorkflow);
}

export function deleteWorkflow(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
}
