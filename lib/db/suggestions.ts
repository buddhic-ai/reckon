import { getDb } from "./client";
import type { Suggestion } from "@/lib/home/types";

interface Row {
  fingerprint: string;
  json: string;
  generated_at: string;
}

export interface CachedSuggestions {
  fingerprint: string;
  suggestions: Suggestion[];
  generatedAt: string;
}

export function getSuggestionsByFingerprint(fingerprint: string): CachedSuggestions | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM home_suggestions WHERE fingerprint = ?")
    .get(fingerprint) as Row | undefined;
  if (!row) return null;
  return {
    fingerprint: row.fingerprint,
    suggestions: JSON.parse(row.json) as Suggestion[],
    generatedAt: row.generated_at,
  };
}

/**
 * Most recently generated chips, regardless of fingerprint. The home page
 * shows these even when they don't match the current schema fingerprint —
 * better to show stale chips while the boot job regenerates than to show
 * generic fallbacks every time the schema shifts.
 */
export function getLatestSuggestions(): CachedSuggestions | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM home_suggestions ORDER BY generated_at DESC LIMIT 1")
    .get() as Row | undefined;
  if (!row) return null;
  return {
    fingerprint: row.fingerprint,
    suggestions: JSON.parse(row.json) as Suggestion[],
    generatedAt: row.generated_at,
  };
}

export function saveSuggestions(fingerprint: string, suggestions: Suggestion[]): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO home_suggestions (fingerprint, json, generated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(fingerprint) DO UPDATE SET
       json = excluded.json,
       generated_at = excluded.generated_at`
  ).run(fingerprint, JSON.stringify(suggestions), new Date().toISOString());
}
