import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ChevronDown, MessageCircle, UserPlus, UserMinus, Ban, Pencil } from 'lucide-react';
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

export interface UserProfileCardProps {
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

export default function UserProfileCard({ userId, user: preloaded, anchor, onClose }: UserProfileCardProps) {
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
        <div ref={cardRef} className="fixed z-50 bg-surface border border-divider rounded-xl shadow-popup p-6 w-75">
          <div className="text-text-tertiary text-sm text-center">
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
      <div ref={cardRef} className="fixed z-50 w-75" style={{ left: anchor.x, top: anchor.y }}>
        <div className="bg-surface border border-divider rounded-xl shadow-popup overflow-hidden">
          {/* Banner area */}
          <div className="h-15 bg-accent/30" />

          {/* Avatar */}
          <div className="px-4 -mt-8">
            <div className="border-4 border-surface rounded-full inline-block">
              <Avatar url={user.avatar_url} name={user.username} size={64} status={status} userId={user.id} />
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
              <span className="text-text-tertiary text-xs">{statusLabel(status)}</span>
            </div>
            {user.status && (
              <div className="text-text-tertiary text-xs mt-0.5 italic">{user.status}</div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-4 border-t border-divider" />

          {/* Bio & Info */}
          <div className="px-4 py-3">
            {user.bio && (
              <div className="mb-3">
                <div className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-1">About Me</div>
                <div className="text-text-secondary text-sm whitespace-pre-wrap break-words max-h-50 overflow-y-auto">{user.bio}</div>
              </div>
            )}
            {joinedDate && (
              <div>
                <div className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-1">Member Since</div>
                <div className="text-text-secondary text-sm">{joinedDate}</div>
              </div>
            )}
            {!isOwnProfile && safetyNumber && (
              <div className="mt-3">
                <button
                  onClick={() => setShowSafetyNumber((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-bold text-text-tertiary uppercase tracking-wider hover:text-text-secondary"
                >
                  <ShieldCheck className="w-3 h-3" />
                  Safety Number
                  <ChevronDown className={`w-3 h-3 transition-transform ${showSafetyNumber ? 'rotate-180' : ''}`} />
                </button>
                {showSafetyNumber && (
                  <div className="mt-2 p-2 bg-bg rounded text-xs font-mono text-text-secondary leading-relaxed tracking-widest select-all break-all">
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
                <div className="text-xs text-danger bg-danger/10 px-2 py-1 rounded">{actionError}</div>
              )}
              <button
                onClick={handleSendMessage}
                className="w-full px-3 py-2 btn-primary text-sm rounded-lg flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                Send Message
              </button>

              {friendStatus === 'none' && (
                <button
                  onClick={handleSendFriendRequest}
                  disabled={actionLoading}
                  className="w-full px-3 py-2 bg-online/20 hover:bg-online/30 text-online text-sm rounded flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <UserPlus className="w-4 h-4" />
                  Add Friend
                </button>
              )}

              {friendStatus === 'pending' && (
                <div className="text-center text-text-tertiary text-xs py-1">Friend request pending</div>
              )}

              {friendStatus === 'accepted' && (
                <button
                  onClick={handleRemoveFriend}
                  disabled={actionLoading}
                  className="w-full px-3 py-2 text-danger hover:bg-danger/10 text-sm rounded flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <UserMinus className="w-4 h-4" />
                  Remove Friend
                </button>
              )}

              {friendStatus === 'loading' && (
                <div className="text-center text-text-tertiary text-xs py-1">...</div>
              )}

              {friendStatus === 'blocked' && (
                <div className="text-center text-danger text-xs py-1">User Blocked</div>
              )}

              {friendStatus !== 'blocked' && friendStatus !== 'loading' && (
                <button
                  onClick={() => setShowBlockConfirm(true)}
                  disabled={actionLoading}
                  className="w-full px-3 py-2 text-danger/70 hover:bg-danger/10 hover:text-danger text-sm rounded flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Ban className="w-4 h-4" />
                  Block
                </button>
              )}
            </div>
          )}

          {isOwnProfile && (
            <div className="px-4 pb-4">
              <button
                onClick={() => { onClose(); navigate('/settings'); }}
                className="w-full px-3 py-2 bg-surface hover:bg-hover text-text-primary text-sm rounded flex items-center justify-center gap-2"
              >
                <Pencil className="w-4 h-4" />
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
