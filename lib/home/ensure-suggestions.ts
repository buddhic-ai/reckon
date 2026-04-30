import { computeKnowledgeFingerprint } from "./fingerprint";
import { getSuggestionsByFingerprint } from "@/lib/db/suggestions";
import { generateSuggestions } from "./generate-suggestions";

let inFlight: Promise<void> | null = null;

/**
 * Boot-time hook: if the current knowledge-pack fingerprint already has chips
 * cached in the DB, do nothing. Otherwise kick off the chip-generator agent
 * in the background. Safe to call multiple times — concurrent calls share
 * the same in-flight promise.
 *
 * Fire-and-forget: callers should not await this. The home page falls back to
 * the most recent cached chips (or a generic set) until generation lands.
 */
export function ensureSuggestionsAtBoot(): void {
  if (inFlight) return;
  const fingerprint = computeKnowledgeFingerprint();
  if (!fingerprint) {
    console.warn(
      "[home/suggestions] knowledge pack not on disk yet; skipping chip generation"
    );
    return;
  }
  const existing = getSuggestionsByFingerprint(fingerprint);
  if (existing) return;

  console.log(
    `[home/suggestions] no chips for fingerprint ${fingerprint}; generating in background`
  );
  inFlight = (async () => {
    try {
      const res = await generateSuggestions(fingerprint);
      if (res.ok) {
        console.log(
          `[home/suggestions] saved chips for ${fingerprint}` +
            (res.totalCostUsd != null ? ` (cost $${res.totalCostUsd.toFixed(4)})` : "")
        );
      } else {
        console.error(
          `[home/suggestions] generator failed: ${res.errorMessage ?? "unknown"}`
        );
      }
    } catch (err) {
      console.error(
        `[home/suggestions] generator threw: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      inFlight = null;
    }
  })();
}
