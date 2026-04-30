import type { RunEvent } from "./event-types";
import { AsyncMessageQueue } from "./async-queue";

/** Shape compatible with what the Agent SDK accepts as a streamed user message. */
export interface SDKUserMessageLike {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: string | null;
}

interface PendingQuestion {
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
}

export interface RunContext {
  runId: string;
  emit: (event: RunEvent) => void;
  /** Register a question; resolves when /api/answer arrives with the matching id. */
  waitForAnswer: (questionId: string) => Promise<string>;
  /** Resolve a pending question. Returns false if no run found. Buffers if waiter not registered yet. */
  resolveAnswer: (questionId: string, answer: string) => boolean;
  /** Push an operator guidance message into the running agent's prompt stream. */
  sendUserMessage: (text: string) => boolean;
  /**
   * Abort the SDK invocation backing this run. Called from /api/run/:id/abort
   * when the user clicks Stop in the UI. The runner observes the
   * AbortController and finishes with status="aborted".
   */
  abort: (reason?: string) => boolean;
  /** Tear down — rejects pending questions, closes the message queue, removes the run. */
  close: (reason?: string) => void;
}

interface RunEntry {
  ctx: RunContext;
  pending: Map<string, PendingQuestion>;
  /** Answers that arrived before the corresponding waitForAnswer registered. */
  unclaimed: Map<string, string>;
}

/**
 * Next.js dev mode compiles API routes separately, producing a fresh module
 * instance per route. Stash the registry on globalThis so /api/run and
 * /api/answer share state.
 */
type RegistryGlobal = typeof globalThis & {
  __agentRunRegistry?: Map<string, RunEntry>;
};
const globalRegistry = globalThis as RegistryGlobal;
const runs: Map<string, RunEntry> =
  globalRegistry.__agentRunRegistry ??
  (globalRegistry.__agentRunRegistry = new Map());

export function registerRun(
  runId: string,
  emit: (event: RunEvent) => void,
  messageQueue: AsyncMessageQueue<SDKUserMessageLike>,
  abortController: AbortController
): RunContext {
  const pending = new Map<string, PendingQuestion>();
  const unclaimed = new Map<string, string>();

  const ctx: RunContext = {
    runId,
    emit,
    waitForAnswer(questionId) {
      return new Promise<string>((resolve, reject) => {
        const buffered = unclaimed.get(questionId);
        if (buffered !== undefined) {
          unclaimed.delete(questionId);
          resolve(buffered);
          return;
        }
        pending.set(questionId, { resolve, reject });
      });
    },
    resolveAnswer(questionId, answer) {
      const q = pending.get(questionId);
      if (!q) {
        unclaimed.set(questionId, answer);
        return true;
      }
      pending.delete(questionId);
      q.resolve(answer);
      return true;
    },
    sendUserMessage(text) {
      if (messageQueue.isClosed) return false;
      messageQueue.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      });
      return true;
    },
    abort(reason) {
      if (abortController.signal.aborted) return false;
      emit({ type: "status", text: reason ?? "Stopped by user." });
      abortController.abort();
      // Closing the queue makes the SDK's prompt stream complete cleanly so
      // the for-await loop exits even if the agent was waiting on input.
      messageQueue.close();
      return true;
    },
    close(reason) {
      for (const q of pending.values()) {
        q.reject(new Error(reason ?? "run closed"));
      }
      pending.clear();
      unclaimed.clear();
      messageQueue.close();
      runs.delete(runId);
    },
  };

  runs.set(runId, { ctx, pending, unclaimed });
  return ctx;
}

export function getRun(runId: string): RunContext | undefined {
  return runs.get(runId)?.ctx;
}

export function activeRunCount(): number {
  return runs.size;
}
