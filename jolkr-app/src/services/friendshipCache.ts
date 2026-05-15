/**
 * Module-level friendship cache shared by ProfileCard, UserContextMenu, and
 * any other surface that needs to know whether the current user is friends
 * with a given target. Avoids hammering /friends + /friends/pending on every
 * card open.
 *
 * Consumers MUST call `invalidateFriendsCache()` after any mutation
 * (sendFriendRequest, declineFriend, removeFriendByUserId, blockUser) so the
 * next read reflects the new state.
 *
 * Module-level WS listener invalidates the cache on any `FriendshipUpdate`
 * so views subscribed via `subscribeFriendsCacheInvalidate` refresh without
 * each component owning its own WS handler.
 */

import * as api from '../api/client';
import { wsClient } from '../api/ws';
import { createTtlCache } from '../utils/cache';
import type { Friendship } from '../api/types';

interface FriendshipBundle {
  friends: Friendship[];
  pending: Friendship[];
}

const FRIENDS_CACHE_TTL = 30_000;
const cache = createTtlCache<'all', FriendshipBundle>({ ttl: FRIENDS_CACHE_TTL });

export type FriendshipState = 'none' | 'pending' | 'accepted' | 'blocked';

export interface FriendshipLookup {
  state: FriendshipState;
  friendship?: Friendship;
}

export async function loadFriendships(): Promise<FriendshipBundle> {
  const cached = cache.get('all');
  if (cached) return cached;
  const [friends, pending] = await Promise.all([api.getFriends(), api.getPendingFriends()]);
  const bundle = { friends, pending };
  cache.set('all', bundle);
  return bundle;
}

/** Look up the friendship, hitting the cache (or fetching) as needed. */
export async function lookupFriendship(userId: string): Promise<FriendshipLookup> {
  const { friends, pending } = await loadFriendships();
  return matchInLists(userId, friends, pending);
}

function matchInLists(userId: string, friends: Friendship[], pending: Friendship[]): FriendshipLookup {
  const all = [...friends, ...pending];
  const match = all.find((f) => f.requester_id === userId || f.addressee_id === userId);
  if (!match) return { state: 'none' };
  if (match.status === 'accepted') return { state: 'accepted', friendship: match };
  if (match.status === 'blocked')  return { state: 'blocked',  friendship: match };
  return { state: 'pending', friendship: match };
}

const subscribers = new Set<() => void>();

/** Subscribe to cache-invalidation events. Returns an unsubscribe function. */
export function subscribeFriendsCacheInvalidate(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export function invalidateFriendsCache(): void {
  cache.clear();
  for (const cb of subscribers) {
    try { cb(); } catch (e) { console.warn('friendshipCache subscriber threw:', e); }
  }
}

// WS-driven invalidation — keeps state fresh after mutations made by another
// session or by the other party (accept/decline/block/remove). Subscribers
// re-fetch via loadFriendships() which re-populates the cache.
wsClient.on(ev => {
  if (ev.op === 'FriendshipUpdate') invalidateFriendsCache();
});
