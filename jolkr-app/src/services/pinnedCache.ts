/**
 * Module-level shared cache for pinned-message lists across the four sites
 * that fetch them: useAppInit (badge count), useAppHandlers.refreshPinnedMeta
 * (post-pin/unpin), DMInfoPanel (pinned tab), PinnedMessagesPanel (pop-up).
 *
 * Keyed by `${isDm ? 'dm' : 'ch'}:${channelId}:${pinnedVersion}` so a pin/unpin
 * (which bumps pinnedVersion in useAppInit) automatically invalidates the
 * prior entry. TTL + LRU keep growth bounded.
 */

import * as api from '../api/client';
import { createTtlCache } from '../utils/cache';
import type { Message } from '../api/types';

const cache = createTtlCache<string, Message[]>({ ttl: 60_000, maxEntries: 60 });

function pinnedKey(channelId: string, isDm: boolean, version: number): string {
  return `${isDm ? 'dm' : 'ch'}:${channelId}:${version}`;
}

/** Fetch the pinned list, hitting the cache (or wire) as needed. */
export async function loadPinnedMessages(channelId: string, isDm: boolean, version: number): Promise<Message[]> {
  const k = pinnedKey(channelId, isDm, version);
  const cached = cache.get(k);
  if (cached !== undefined) return cached;
  try {
    const msgs = isDm ? await api.getDmPinnedMessages(channelId) : await api.getPinnedMessages(channelId);
    cache.set(k, msgs);
    return msgs;
  } catch {
    return [];
  }
}

/** Synchronous cache peek — returns `undefined` when cold. */
export function peekPinnedMessages(channelId: string, isDm: boolean, version: number): Message[] | undefined {
  return cache.get(pinnedKey(channelId, isDm, version));
}

/** Write through to the cache (e.g. after an optimistic unpin). */
export function setPinnedMessagesCache(channelId: string, isDm: boolean, version: number, msgs: Message[]): void {
  cache.set(pinnedKey(channelId, isDm, version), msgs);
}
