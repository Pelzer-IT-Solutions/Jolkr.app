import * as api from '../api/client';
import { usePresenceStore } from '../stores/presence';

/** Maximum delay (ms) we'll wait while batching presence requests. */
const BATCH_WINDOW_MS = 50;

/** In-flight ids we've already asked about — prevents the same user_id being
 *  re-queried by every parallel callsite during initial load. Cleared once the
 *  batched fetch resolves. */
const inFlight = new Set<string>();

/** Pending ids waiting to be sent in the next batch. */
let pending = new Set<string>();
let scheduled: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a presence query for the given user ids.
 *
 * Queries are deduplicated and batched: multiple callsites firing in the same
 * tick (e.g. server load + DM participants + WS DmCreate) hit the API once
 * with the union of ids. Result is written into the presence store via
 * `setBulk` — which itself bails if no statuses changed.
 *
 * Errors are swallowed (logged) — presence is best-effort UX, never fatal.
 */
export function syncPresence(userIds: ReadonlyArray<string>): void {
  if (userIds.length === 0) return;
  for (const id of userIds) {
    if (!inFlight.has(id)) pending.add(id);
  }
  if (pending.size === 0) return;
  if (scheduled) return;

  scheduled = setTimeout(flush, BATCH_WINDOW_MS);
}

async function flush(): Promise<void> {
  scheduled = null;
  if (pending.size === 0) return;
  const batch = Array.from(pending);
  pending = new Set();
  for (const id of batch) inFlight.add(id);
  try {
    const result = await api.queryPresence(batch);
    usePresenceStore.getState().setBulk(result);
  } catch (e) {
    console.warn('[presenceSync]', e);
  } finally {
    for (const id of batch) inFlight.delete(id);
  }
}
