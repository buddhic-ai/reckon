import { getRunEvents } from "@/lib/db/runs";
import type { RunEvent } from "./event-types";

/** Read all persisted events for a run, in order, for replay rendering. */
export function replayRun(runId: string): RunEvent[] {
  return getRunEvents(runId);
}
