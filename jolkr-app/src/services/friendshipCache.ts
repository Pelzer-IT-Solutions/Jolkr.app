/**
 * Module-level friendship cache shared by ProfileCard, UserContextMenu, and
 * any other surface that needs to know whether the current user is friends
 * with a given target. Avoids hammering /friends + /friends/pending on every
 * card open.
 *
 * Consumers MUST call `invalidateFriendsCache()` after any mutation
 * (sendFriendRequest, declineFriend, removeFriendByUserId, blockUser) so the
 * next read reflects the new state.
 */

import type { Friendship } from '../api/types';
import * as api from '../api/client';

let friendsCacheData: Friendship[] | null = null;
let pendingCacheData: Friendship[] | null = null;
let friendsCacheTime = 0;
const FRIENDS_CACHE_TTL = 30_000;

export type FriendshipState = 'none' | 'pending' | 'accepted' | 'blocked';

export interface FriendshipLookup {
  state: FriendshipState;
  friendship?: Friendship;
}

export async function loadFriendships(): Promise<{ friends: Friendship[]; pending: Friendship[] }> {
  const now = Date.now();
  if (friendsCacheData && pendingCacheData && now - friendsCacheTime < FRIENDS_CACHE_TTL) {
    return { friends: friendsCacheData, pending: pendingCacheData };
  }
  const [friends, pending] = await Promise.all([api.getFriends(), api.getPendingFriends()]);
  friendsCacheData = friends;
  pendingCacheData = pending;
  friendsCacheTime = now;
  return { friends, pending };
}

/** Synchronously check the cached friendship — returns `null` when cache is cold. */
export function peekFriendship(userId: string): FriendshipLookup | null {
  if (!friendsCacheData || !pendingCacheData) return null;
  return matchInLists(userId, friendsCacheData, pendingCacheData);
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

export function invalidateFriendsCache(): void {
  friendsCacheData = null;
  pendingCacheData = null;
  friendsCacheTime = 0;
}
