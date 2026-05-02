import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ChevronDown, MessageCircle, UserPlus, UserMinus, Ban, Pencil } from 'lucide-react';
import type { User } from '../../api/types';
import { useAuthStore } from '../../stores/auth';
import { usePresenceStore } from '../../stores/presence';
import * as api from '../../api/client';
import Avatar from '../Avatar';
import { hashColor } from '../../adapters/transforms';
import {
  lookupFriendship,
  invalidateFriendsCache,
  type FriendshipState,
} from '../../services/friendshipCache';
import s from './ProfileCard.module.css';

type FriendStatus = FriendshipState | 'loading';

const STATUS_LABEL: Record<string, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  offline: 'Offline',
};

/** Open-state for the profile card popover. Mirrors `UserContextMenuState` shape. */
export interface ProfileCardState {
  x: number;
  y: number;
  userId: string;
  /** Pre-loaded user data (avoids extra fetch if already known). */
  user?: User | null;
}

export interface ProfileCardProps {
  state: ProfileCardState;
  onClose: () => void;
}

export function ProfileCard({ state, onClose }: ProfileCardProps) {
  const { userId, user: preloaded, x, y } = state;
  const anchor = { x, y };
  const navigate = useNavigate();
  const currentUser = useAuthStore((st) => st.user);
  const presenceStatus = usePresenceStore((st) => st.statuses[userId]);
  const [user, setUser] = useState<User | null>(preloaded ?? null);
  const [fetchError, setFetchError] = useState(false);
  const [friendStatus, setFriendStatus] = useState<FriendStatus>('loading');
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const isOwnProfile = currentUser?.id === userId;
  const status = presenceStatus ?? (user?.is_online ? 'online' : 'offline');
  const bannerColor = user?.banner_color ?? hashColor(userId);

  // Fetch user details if not pre-loaded.
  useEffect(() => {
    if (preloaded) {
      setUser(preloaded);
      return;
    }
    let stale = false;
    setFetchError(false);
    api.getUser(userId)
      .then((u) => { if (!stale) setUser(u); })
      .catch(() => { if (!stale) setFetchError(true); });
    return () => { stale = true; };
  }, [userId, preloaded]);

  // Determine friendship state via cached friends list.
  useEffect(() => {
    if (isOwnProfile) {
      setFriendStatus('none');
      return;
    }
    let cancelled = false;
    lookupFriendship(userId)
      .then((lookup) => {
        if (cancelled) return;
        setFriendshipId(lookup.friendship?.id ?? null);
        setFriendStatus(lookup.state);
      })
      .catch(() => { if (!cancelled) setFriendStatus('none'); });
    return () => { cancelled = true; };
  }, [userId, isOwnProfile]);

  // E2EE safety number (lazy-imported to avoid pulling crypto into every bundle).
  useEffect(() => {
    if (isOwnProfile) return;
    let cancelled = false;
    (async () => {
      try {
        const { getLocalKeys, getRecipientBundle } = await import('../../services/e2ee');
        const { generateSafetyNumber } = await import('../../crypto');
        const local = getLocalKeys();
        if (!local) return;
        const bundle = await getRecipientBundle(userId);
        if (!bundle || cancelled) return;
        const sn = await generateSafetyNumber(local.identity.publicKey, bundle.identityKey);
        if (!cancelled) setSafetyNumber(sn);
      } catch { /* E2EE unavailable — skip silently */ }
    })();
    return () => { cancelled = true; };
  }, [userId, isOwnProfile]);

  // Position the card within the viewport (no flicker).
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = anchor.x;
    let y = anchor.y;
    if (x + rect.width > vw - 16) x = vw - rect.width - 16;
    if (x < 16) x = 16;
    if (y + rect.height > vh - 16) y = Math.max(16, vh - rect.height - 16);
    if (y < 16) y = 16;
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }, [anchor, user]);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSendMessage = async () => {
    setActionError(null);
    try {
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
      if (friendshipId) {
        await api.declineFriend(friendshipId);
        invalidateFriendsCache();
        setFriendshipId(null);
        setFriendStatus('none');
      }
    } catch (e) {
      setActionError((e as Error).message || 'Failed to remove friend');
    }
    setActionLoading(false);
  };

  const handleBlock = async () => {
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
        <div className={s.scrim} onClick={onClose} />
        <div ref={cardRef} className={s.card}>
          <div className={s.loadingBody}>
            {fetchError ? 'Could not load user profile' : 'Loading…'}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  const joinedDate = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;
  const displayName = user.display_name || user.username;

  return createPortal(
    <>
      <div className={s.scrim} onClick={onClose} />
      <div ref={cardRef} className={s.card} role="dialog" aria-label={`${displayName} profile`}>
        <div className={s.banner} style={{ background: bannerColor }} />

        <div className={s.avatarWrap}>
          <Avatar
            url={user.avatar_url}
            name={displayName}
            size="2xl"
            status={status}
            userId={user.id}
          />
        </div>

        <div className={s.body}>
          <div className={s.nameBlock}>
            <span className={`${s.displayName} txt-shout txt-bold`}>{displayName}</span>
            {user.display_name && (
              <span className={`${s.handle} txt-small`}>@{user.username}</span>
            )}
            <div className={s.statusRow}>
              <span className={`${s.statusDot} ${s[`status_${status}`] ?? ''}`} />
              <span className={`txt-small ${s.statusLabel}`}>{STATUS_LABEL[status] ?? status}</span>
            </div>
            {user.status && (
              <span className={`${s.customStatus} txt-small`}>{user.status}</span>
            )}
          </div>

          {(user.bio || joinedDate || safetyNumber) && <div className={s.divider} />}

          {user.bio && (
            <section className={s.section}>
              <h3 className={`${s.sectionLabel} txt-tiny`}>About</h3>
              <p className={`${s.bio} txt-small`}>{user.bio}</p>
            </section>
          )}

          {joinedDate && (
            <section className={s.section}>
              <h3 className={`${s.sectionLabel} txt-tiny`}>Member Since</h3>
              <p className={`txt-small ${s.dim}`}>{joinedDate}</p>
            </section>
          )}

          {safetyNumber && (
            <section className={s.section}>
              <button
                type="button"
                className={s.sectionToggle}
                onClick={() => setShowSafetyNumber((v) => !v)}
              >
                <ShieldCheck size={11} strokeWidth={1.75} />
                <span className="txt-tiny">Safety Number</span>
                <ChevronDown
                  size={11}
                  strokeWidth={1.75}
                  className={showSafetyNumber ? s.chevronOpen : s.chevron}
                />
              </button>
              {showSafetyNumber && (
                <pre className={s.safetyNumber}>{safetyNumber}</pre>
              )}
            </section>
          )}
        </div>

        <div className={s.actions}>
          {actionError && <div className={`${s.errorMsg} txt-tiny`}>{actionError}</div>}

          {!isOwnProfile && (
            <>
              <button
                className={`${s.btn} ${s.btnPrimary}`}
                onClick={handleSendMessage}
                disabled={actionLoading}
              >
                <MessageCircle size={14} strokeWidth={1.75} />
                Send Message
              </button>

              {friendStatus === 'none' && (
                <button
                  className={s.btn}
                  onClick={handleSendFriendRequest}
                  disabled={actionLoading}
                >
                  <UserPlus size={14} strokeWidth={1.75} />
                  Add Friend
                </button>
              )}
              {friendStatus === 'pending' && (
                <div className={`${s.statusInline} txt-small`}>Friend request pending</div>
              )}
              {friendStatus === 'accepted' && (
                <button
                  className={`${s.btn} ${s.btnDanger}`}
                  onClick={handleRemoveFriend}
                  disabled={actionLoading}
                >
                  <UserMinus size={14} strokeWidth={1.75} />
                  Remove Friend
                </button>
              )}
              {friendStatus === 'blocked' && (
                <div className={`${s.statusInline} ${s.statusBlocked} txt-small`}>User blocked</div>
              )}

              {friendStatus !== 'blocked' && friendStatus !== 'loading' && (
                <button
                  className={`${s.btn} ${s.btnDangerSubtle}`}
                  onClick={handleBlock}
                  disabled={actionLoading}
                >
                  <Ban size={14} strokeWidth={1.75} />
                  Block
                </button>
              )}
            </>
          )}

          {isOwnProfile && (
            <button
              className={s.btn}
              onClick={() => { onClose(); navigate('/settings'); }}
            >
              <Pencil size={14} strokeWidth={1.75} />
              Edit Profile
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
