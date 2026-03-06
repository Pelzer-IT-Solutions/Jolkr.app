import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { User } from '../api/types';
import { useAuthStore } from '../stores/auth';
import { usePresenceStore } from '../stores/presence';
import * as api from '../api/client';
import Avatar from './Avatar';
import ConfirmDialog from './dialogs/ConfirmDialog';
import { getLocalKeys, getRecipientBundle } from '../services/e2ee';
import { generateSafetyNumber } from '../crypto';

// Module-level cache for friendship data (avoids re-fetching on every card open)
let friendsCacheData: Awaited<ReturnType<typeof api.getFriends>> | null = null;
let pendingCacheData: Awaited<ReturnType<typeof api.getPendingFriends>> | null = null;
let friendsCacheTime = 0;
const FRIENDS_CACHE_TTL = 30_000; // 30 seconds

async function getCachedFriendships() {
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

/** Invalidate friendship cache after mutations */
function invalidateFriendsCache() {
  friendsCacheData = null;
  pendingCacheData = null;
  friendsCacheTime = 0;
}

interface Props {
  userId: string;
  /** Pre-loaded user data (avoids extra fetch if available) */
  user?: User | null;
  /** Position anchor — the card will render near this point */
  anchor: { x: number; y: number };
  onClose: () => void;
}

function statusLabel(s: string): string {
  switch (s) {
    case 'online': return 'Online';
    case 'idle': return 'Idle';
    case 'dnd': return 'Do Not Disturb';
    case 'offline': return 'Offline';
    default: return s;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'online': return 'bg-online';
    case 'idle': return 'bg-idle';
    case 'dnd': return 'bg-dnd';
    default: return 'bg-text-muted';
  }
}

export default function UserProfileCard({ userId, user: preloaded, anchor, onClose }: Props) {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const presenceStatus = usePresenceStore((s) => s.statuses[userId]);
  const [user, setUser] = useState<User | null>(preloaded ?? null);
  const [fetchError, setFetchError] = useState(false);
  const [friendStatus, setFriendStatus] = useState<'none' | 'pending' | 'accepted' | 'blocked' | 'loading'>('loading');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const isOwnProfile = currentUser?.id === userId;
  const status = presenceStatus ?? (user?.is_online ? 'online' : 'offline');

  useEffect(() => {
    let stale = false;
    setFetchError(false);
    if (preloaded) {
      setUser(preloaded);
    } else {
      api.getUser(userId).then((u) => { if (!stale) setUser(u); }).catch(() => { if (!stale) setFetchError(true); });
    }
    return () => { stale = true; };
  }, [userId, preloaded]);

  // Check friendship status (uses cached data to avoid re-fetching on every card open)
  useEffect(() => {
    if (isOwnProfile) {
      setFriendStatus('none');
      return;
    }
    let cancelled = false;
    getCachedFriendships().then(({ friends, pending }) => {
      if (cancelled) return;
      const all = [...friends, ...pending];
      const match = all.find(
        (f) => f.requester_id === userId || f.addressee_id === userId
      );
      if (match) {
        setFriendStatus(match.status === 'accepted' ? 'accepted' : match.status === 'blocked' ? 'blocked' : 'pending');
      } else {
        setFriendStatus('none');
      }
    }).catch(() => { if (!cancelled) setFriendStatus('none'); });
    return () => { cancelled = true; };
  }, [userId, isOwnProfile]);

  // Compute safety number for non-self profiles
  useEffect(() => {
    if (isOwnProfile) return;
    let cancelled = false;
    (async () => {
      const local = getLocalKeys();
      if (!local) return;
      const bundle = await getRecipientBundle(userId);
      if (!bundle || cancelled) return;
      const sn = await generateSafetyNumber(local.identity.publicKey, bundle.identityKey);
      if (!cancelled) setSafetyNumber(sn);
    })();
    return () => { cancelled = true; };
  }, [userId, isOwnProfile]);

  // Position the card within viewport (useLayoutEffect to avoid flicker)
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = anchor.x;
    let y = anchor.y;

    // Keep card within viewport
    if (x + rect.width > vw - 16) x = vw - rect.width - 16;
    if (x < 16) x = 16;
    if (y + rect.height > vh - 16) y = anchor.y - rect.height;
    if (y < 16) y = 16;

    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }, [anchor, user]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSendMessage = async () => {
    try {
      setActionError(null);
      const dm = await api.openDm(userId);
      onClose();
      navigate(`/dm/${dm.id}`);
    } catch (e) {
      setActionError((e as Error).message || 'Failed to open DM');
    }
  };

  const handleSendFriendRequest = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      await api.sendFriendRequest(userId);
      invalidateFriendsCache();
      setFriendStatus('pending');
    } catch (e) {
      setActionError((e as Error).message || 'Failed to send request');
    }
    setActionLoading(false);
  };

  const handleRemoveFriend = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      const { friends, pending } = await getCachedFriendships();
      const match = [...friends, ...pending].find(
        (f) => f.requester_id === userId || f.addressee_id === userId
      );
      if (match) {
        await api.declineFriend(match.id);
        invalidateFriendsCache();
        setFriendStatus('none');
      }
    } catch (e) {
      setActionError((e as Error).message || 'Failed to remove friend');
    }
    setActionLoading(false);
  };

  const handleBlockUser = async () => {
    setShowBlockConfirm(false);
    setActionLoading(true);
    setActionError(null);
    try {
      await api.blockUser(userId);
      invalidateFriendsCache();
      setFriendStatus('blocked');
    } catch (e) {
      setActionError((e as Error).message || 'Failed to block user');
    }
    setActionLoading(false);
  };

  if (!user) {
    return createPortal(
      <>
        <div className="fixed inset-0 z-40" onClick={onClose} />
        <div ref={cardRef} className="fixed z-50 bg-surface rounded-lg shadow-xl border border-divider p-6 w-[300px]">
          <div className="text-text-muted text-sm text-center">
            {fetchError ? 'Could not load user profile' : 'Loading...'}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  const joinedDate = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={cardRef} className="fixed z-50 w-[300px]" style={{ left: anchor.x, top: anchor.y }}>
        <div className="bg-surface rounded-lg shadow-xl border border-divider overflow-hidden">
          {/* Banner area */}
          <div className="h-[60px] bg-primary/30" />

          {/* Avatar */}
          <div className="px-4 -mt-8">
            <div className="border-[4px] border-surface rounded-full inline-block">
              <Avatar url={user.avatar_url} name={user.username} size={64} status={status} />
            </div>
          </div>

          {/* User info */}
          <div className="px-4 pt-2 pb-3">
            <div className="text-text-primary font-semibold text-lg truncate">{user.display_name ?? user.username}</div>
            {user.display_name && (
              <div className="text-text-secondary text-sm">{user.username}</div>
            )}

            {/* Status */}
            <div className="flex items-center gap-1.5 mt-1">
              <div className={`w-2 h-2 rounded-full ${statusColor(status)}`} />
              <span className="text-text-muted text-xs">{statusLabel(status)}</span>
            </div>
            {user.status && (
              <div className="text-text-muted text-xs mt-0.5 italic">{user.status}</div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-4 border-t border-divider" />

          {/* Bio & Info */}
          <div className="px-4 py-3">
            {user.bio && (
              <div className="mb-3">
                <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">About Me</div>
                <div className="text-text-secondary text-sm whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">{user.bio}</div>
              </div>
            )}
            {joinedDate && (
              <div>
                <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">Member Since</div>
                <div className="text-text-secondary text-sm">{joinedDate}</div>
              </div>
            )}
            {!isOwnProfile && safetyNumber && (
              <div className="mt-3">
                <button
                  onClick={() => setShowSafetyNumber((v) => !v)}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-text-muted uppercase tracking-wider hover:text-text-secondary"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Safety Number
                  <svg className={`w-3 h-3 transition-transform ${showSafetyNumber ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSafetyNumber && (
                  <div className="mt-2 p-2 bg-bg rounded text-[11px] font-mono text-text-secondary leading-relaxed tracking-widest select-all break-all">
                    {safetyNumber}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          {!isOwnProfile && (
            <div className="px-4 pb-4 flex flex-col gap-2">
              {actionError && (
                <div className="text-[11px] text-error bg-error/10 px-2 py-1 rounded">{actionError}</div>
              )}
              <button
                onClick={handleSendMessage}
                className="w-full px-3 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Send Message
              </button>

              {friendStatus === 'none' && (
                <button
                  onClick={handleSendFriendRequest}
                  disabled={actionLoading}
                  className="w-full px-3 py-2 bg-online/20 hover:bg-online/30 text-online text-sm rounded flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Add Friend
                </button>
              )}

              {friendStatus === 'pending' && (
                <div className="text-center text-text-muted text-xs py-1">Friend request pending</div>
              )}

              {friendStatus === 'accepted' && (
                <button
                  onClick={handleRemoveFriend}
                  disabled={actionLoading}
                  className="w-full px-3 py-2 text-error hover:bg-error/10 text-sm rounded flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                  </svg>
                  Remove Friend
                </button>
              )}

              {friendStatus === 'loading' && (
                <div className="text-center text-text-muted text-xs py-1">...</div>
              )}

              {friendStatus === 'blocked' && (
                <div className="text-center text-error text-xs py-1">User Blocked</div>
              )}

              {friendStatus !== 'blocked' && friendStatus !== 'loading' && (
                <button
                  onClick={() => setShowBlockConfirm(true)}
                  disabled={actionLoading}
                  className="w-full px-3 py-2 text-error/70 hover:bg-error/10 hover:text-error text-sm rounded flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  Block
                </button>
              )}
            </div>
          )}

          {isOwnProfile && (
            <div className="px-4 pb-4">
              <button
                onClick={() => { onClose(); navigate('/settings'); }}
                className="w-full px-3 py-2 bg-input hover:bg-input/80 text-text-primary text-sm rounded flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Profile
              </button>
            </div>
          )}
        </div>
      </div>

      {showBlockConfirm && (
        <ConfirmDialog
          title="Block User"
          message={`Are you sure you want to block ${user.username}? They won't be able to message you.`}
          confirmLabel="Block"
          danger
          onConfirm={handleBlockUser}
          onCancel={() => setShowBlockConfirm(false)}
        />
      )}
    </>,
    document.body,
  );
}
