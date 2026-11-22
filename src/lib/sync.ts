// Client write queue. The store updates in memory immediately and enqueues an
// op here; ops are sent to the server in order, batched, one request at a time.
// Batching coalesces repeated writes (a user turn rewritten as transcription
// arrives, several document updates in a row) into one.

import { createSignal } from "solid-js";
import { authToken } from "./auth";
import { applySync, type SyncOp } from "./dbServer";

const FLUSH_DELAY_MS = 200;
const RETRY_DELAYS_MS = [1000, 3000, 10_000];

let queue: SyncOp[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;

const [syncError, setSyncError] = createSignal("");
export { syncError };

export function enqueue(op: SyncOp): void {
  queue.push(op);
  schedule();
}

export function hasPendingWrites(): boolean {
  return flushing || queue.length > 0;
}

/** Drop unsent writes (on sign-out). */
export function clearQueue(): void {
  queue = [];
  clearTimeout(timer);
  setSyncError("");
}

function schedule(): void {
  if (flushing) return; // the running flush picks up new ops when it finishes
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
}

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = coalesce(queue);
  queue = [];
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await applySync(await authToken(), batch);
        setSyncError("");
        break;
      } catch (error) {
        const message = (error as Error).message;
        if (attempt >= RETRY_DELAYS_MS.length || message.startsWith("Not signed in")) {
          console.error("[sync] write failed, dropping batch:", error, batch);
          setSyncError(`Couldn't save changes: ${message}`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
  } finally {
    flushing = false;
    if (queue.length > 0) schedule();
  }
}

/**
 * Collapse repeats while keeping order: a later putTurn for the same turn
 * replaces the earlier one in place, and consecutive updateConversation ops for
 * the same conversation merge.
 */
function coalesce(ops: SyncOp[]): SyncOp[] {
  const out: SyncOp[] = [];
  const turnIndex = new Map<string, number>();
  for (const op of ops) {
    if (op.op === "putTurn") {
      const at = turnIndex.get(op.turn.id);
      if (at !== undefined) {
        out[at] = op;
        continue;
      }
      turnIndex.set(op.turn.id, out.length);
    } else if (op.op === "updateConversation") {
      const last = out.at(-1);
      if (last?.op === "updateConversation" && last.id === op.id) {
        out[out.length - 1] = { ...last, ...op };
        continue;
      }
    }
    out.push(op);
  }
  return out;
}

// Warn before closing the tab with unsaved writes.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", event => {
    if (hasPendingWrites()) event.preventDefault();
  });
}
