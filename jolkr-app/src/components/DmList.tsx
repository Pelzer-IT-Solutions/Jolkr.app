import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DmChannel, Friendship, User } from '../api/types';
import { useAuthStore } from '../stores/auth';
import { useServersStore } from '../stores/servers';
import { useUnreadStore } from '../stores/unread';
import { usePresenceStore } from '../stores/presence';
import { wsClient } from '../api/ws';
import * as api from '../api/client';
import Avatar from './Avatar';
import UserProfileCard from './UserProfileCard';
import ConfirmDialog from './dialogs/ConfirmDialog';
import CreateGroupDmDialog from './dialogs/CreateGroupDm';

// Module-level DM cache — survives component unmount/remount to prevent flash
let cachedDms: DmChannel[] = [];
let cachedUsers: Record<string, User> = {};
let cachedFetchedIds = new Set<string>();

/** Clamp context menu position to stay within viewport */
function clampMenuPosition(x: number, y: number, menuWidth = 180, menuHeight = 160) {
  const maxX = window.innerWidth - menuWidth - 8;
  const maxY = window.innerHeight - menuHeight - 8;
  return { x: Math.min(x, maxX), y: Math.min(y, maxY) };
}

interface Props {
  onDmSelect?: () => void;
}

export default function DmList({ onDmSelect }: Props) {
  const navigate = useNavigate();
  const { dmId } = useParams();
  const currentUser = useAuthStore((s) => s.user);
  const unreadCounts = useUnreadStore((s) => s.counts);
  const statuses = usePresenceStore((s) => s.statuses);
  const [dms, setDms] = useState<DmChannel[]>(cachedDms);
  const [users, setUsers] = useState<Record<string, User>>(cachedUsers);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wsDebouncerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchedUserIds = useRef(cachedFetchedIds);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ dm: DmChannel; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [friendships, setFriendships] = useState<Map<string, { id: string; status: string }>>(new Map());
  const [confirmAction, setConfirmAction] = useState<{ type: 'block' | 'leave' | 'close'; dm: DmChannel } | null>(null);
  const [profileTarget, setProfileTarget] = useState<{ userId: string; anchor: { x: number; y: number } } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDms = useCallback(() => {
    api.getDms().then((channels) => {
      setFetchError(false);
      setDms(channels);
      cachedDms = channels;
      // Query presence for all DM partners
      const otherMemberIds = channels
        .filter((ch) => !ch.is_group)
        .flatMap((ch) => ch.members.filter((id) => id !== currentUser?.id));
      const uniqueIds = [...new Set(otherMemberIds)];
      if (uniqueIds.length > 0) {
        api.queryPresence(uniqueIds).then((result) => {
          usePresenceStore.getState().setBulk(result);
        }).catch(() => {});
      }
      // Batch fetch user info for DM participants
      const idsToFetch: string[] = [];
      channels.forEach((ch) => ch.members.forEach((id) => {
        if (id !== currentUser?.id && !fetchedUserIds.current.has(id)) {
          fetchedUserIds.current.add(id);
          idsToFetch.push(id);
        }
      }));
      if (idsToFetch.length > 0) {
        api.getUsersBatch(idsToFetch).then((fetchedUsers) => {
          const map: Record<string, typeof fetchedUsers[0]> = {};
          for (const u of fetchedUsers) map[u.id] = u;
          setUsers((prev) => {
            const next = { ...prev, ...map };
            cachedUsers = next;
            return next;
          });
        }).catch(() => {
          // Fallback: fetch users individually
          Promise.all(idsToFetch.map((id) => api.getUser(id).catch(() => null))).then((results) => {
            const map: Record<string, User> = {};
            for (const u of results) if (u) map[u.id] = u;
            setUsers((prev) => {
              const next = { ...prev, ...map };
              cachedUsers = next;
              return next;
            });
          });
        });
      }
    }).catch((e) => {
      console.warn('Failed to fetch DMs:', e);
      setFetchError(true);
    });
  }, [currentUser?.id]);

  useEffect(() => {
    fetchDms();
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [fetchDms]);

  // Auto-refresh when new DM messages arrive or DM channels change
  useEffect(() => {
    const unsub = wsClient.on((op, d) => {
      if (op === 'DmCreate' || op === 'DmUpdate') {
        fetchDms();
      } else if (op === 'MessageCreate') {
        // Refresh DM list if message is from a DM channel (not a server channel)
        const raw = d?.message as Record<string, unknown> | undefined;
        const msgChannelId = raw?.channel_id as string | undefined;
        if (msgChannelId) {
          const allServerChannels = useServersStore.getState().channels;
          const isServerChannel = Object.values(allServerChannels).some(
            (chs) => chs.some((c) => c.id === msgChannelId),
          );
          if (!isServerChannel) {
            if (wsDebouncerRef.current) clearTimeout(wsDebouncerRef.current);
            wsDebouncerRef.current = setTimeout(() => fetchDms(), 500);
          }
        }
      }
    });
    return () => {
      unsub();
      if (wsDebouncerRef.current) clearTimeout(wsDebouncerRef.current);
    };
  }, [fetchDms]);

  // Debounced user search when typing in search bar
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(() => {
      api.searchUsers(value.trim())
        .then((results) => setSearchResults(results.filter((u) => u.id !== currentUser?.id)))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
  }, [currentUser?.id]);

  const [startDmError, setStartDmError] = useState('');
  const startDm = async (userId: string) => {
    setStartDmError('');
    try {
      const dm = await api.openDm(userId);
      setSearch('');
      setSearchResults([]);
      fetchDms();
      navigate(`/dm/${dm.id}`);
      onDmSelect?.();
    } catch (e) {
      setStartDmError((e as Error).message || 'Failed to start conversation');
    }
  };

  // Fetch friendships at mount for context menu friend status
  useEffect(() => {
    Promise.all([api.getFriends(), api.getPendingFriends()]).then(([friends, pending]) => {
      const map = new Map<string, { id: string; status: string }>();
      const all: Friendship[] = [...friends, ...pending];
      for (const f of all) {
        // Map the OTHER user's ID to the friendship
        const otherId = f.requester_id === currentUser?.id ? f.addressee_id : f.requester_id;
        map.set(otherId, { id: f.id, status: f.status });
      }
      setFriendships(map);
    }).catch(() => {});
  }, [currentUser?.id]);

  // Context menu handler
  const handleContextMenu = useCallback((dm: DmChannel, e: React.MouseEvent) => {
    e.preventDefault();
    const pos = clampMenuPosition(e.clientX, e.clientY);
    setContextMenu({ dm, x: pos.x, y: pos.y });
  }, []);

  // Close context menu on click outside + keyboard navigation
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    requestAnimationFrame(() => {
      const items = contextMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      items?.[0]?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const items = contextMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
        if (!items || items.length === 0) return;
        const current = document.activeElement as HTMLElement;
        const idx = Array.from(items).indexOf(current);
        let next = 0;
        if (e.key === 'ArrowDown') next = idx < items.length - 1 ? idx + 1 : 0;
        else if (e.key === 'ArrowUp') next = idx > 0 ? idx - 1 : items.length - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        items[next]?.focus();
      }
      if (e.key === 'Tab') { e.preventDefault(); close(); }
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // Context menu action handlers
  const handleViewProfile = (dm: DmChannel) => {
    const otherIds = dm.members.filter((id) => id !== currentUser?.id);
    if (otherIds.length > 0) {
      setProfileTarget({ userId: otherIds[0], anchor: { x: contextMenu?.x ?? 300, y: contextMenu?.y ?? 300 } });
    }
    setContextMenu(null);
  };

  const handleAddFriend = async (userId: string) => {
    setContextMenu(null);
    try {
      await api.sendFriendRequest(userId);
      // Refresh friendships
      const [friends, pending] = await Promise.all([api.getFriends(), api.getPendingFriends()]);
      const map = new Map<string, { id: string; status: string }>();
      for (const f of [...friends, ...pending]) {
        const otherId = f.requester_id === currentUser?.id ? f.addressee_id : f.requester_id;
        map.set(otherId, { id: f.id, status: f.status });
      }
      setFriendships(map);
    } catch (e) {
      console.warn('Failed to send friend request:', e);
    }
  };

  const handleRemoveFriend = async (userId: string) => {
    setContextMenu(null);
    const friendship = friendships.get(userId);
    if (!friendship) return;
    try {
      await api.declineFriend(friendship.id);
      setFriendships((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    } catch (e) {
      console.warn('Failed to remove friend:', e);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    try {
      if (confirmAction.type === 'block') {
        const otherIds = confirmAction.dm.members.filter((id) => id !== currentUser?.id);
        if (otherIds[0]) {
          await api.blockUser(otherIds[0]);
          // Refresh friendships
          const [friends, pending] = await Promise.all([api.getFriends(), api.getPendingFriends()]);
          const map = new Map<string, { id: string; status: string }>();
          for (const f of [...friends, ...pending]) {
            const otherId = f.requester_id === currentUser?.id ? f.addressee_id : f.requester_id;
            map.set(otherId, { id: f.id, status: f.status });
          }
          setFriendships(map);
        }
      } else if (confirmAction.type === 'close' || confirmAction.type === 'leave') {
        await api.leaveDm(confirmAction.dm.id);
        fetchDms();
        // Navigate away if we're viewing this DM
        if (dmId === confirmAction.dm.id) {
          navigate('/friends');
        }
      }
    } catch (e) {
      console.warn(`Failed to ${confirmAction.type}:`, e);
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  /** Get display info for a DM channel */
  const getDmDisplay = (dm: DmChannel) => {
    const otherIds = dm.members.filter((id) => id !== currentUser?.id);

    if (dm.is_group) {
      // Group DM
      const memberNames = otherIds
        .map((id) => users[id]?.username)
        .filter(Boolean)
        .join(', ');
      const displayName = dm.name || memberNames || 'Group DM';
      const subtitle = `${dm.members.length} members`;
      return { displayName, subtitle, isGroup: true, otherIds };
    }

    // 1-on-1 DM
    const otherId = otherIds.length > 0 ? otherIds[0] : null;
    const otherUser = otherId ? users[otherId] : null;
    const displayName = dm.name ?? otherUser?.username ?? 'Direct Message';
    return { displayName, subtitle: null, isGroup: false, otherIds, otherId, otherUser };
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="h-14 px-4 flex items-center border-b border-divider shrink-0">
        <h2 className="text-text-primary font-semibold text-[15px]">Direct Messages</h2>
      </div>

      {/* Search bar */}
      <div className="px-2 pt-2">
        <input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Find or start a conversation"
          className="w-full bg-input rounded px-3 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted outline-none"
        />
      </div>

      {/* User search results for starting new DMs — absolute to prevent layout shift */}
      <div className="relative">
        {search.trim().length >= 2 && searchResults.length > 0 && (
          <div className="absolute left-0 right-0 top-0 z-20 bg-sidebar border border-divider rounded-lg mx-2 mt-1 py-1 shadow-lg animate-dropdown-enter">
            <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider px-3 py-1">Start a conversation</div>
            {searchResults.slice(0, 5).map((u) => (
              <button
                key={u.id}
                onClick={() => startDm(u.id)}
                className="w-full px-3 py-1.5 rounded flex items-center gap-2 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary"
              >
                <Avatar url={u.avatar_url} name={u.username} size={28} />
                <span className="truncate">{u.username}</span>
              </button>
            ))}
          </div>
        )}
        {search.trim().length >= 2 && searching && (
          <div className="px-4 pt-2 text-[11px] text-text-muted">Searching users...</div>
        )}
        {startDmError && (
          <div className="mx-2 mt-1 px-3 py-1.5 bg-error/10 text-error text-xs rounded">{startDmError}</div>
        )}
      </div>

      {/* Friends link */}
      <Link
        to="/friends"
        onClick={() => onDmSelect?.()}
        aria-label="Friends"
        className="mx-2 mt-2 px-3 py-2 rounded flex items-center gap-2 text-text-secondary hover:bg-white/5 hover:text-text-primary text-sm cursor-pointer no-underline"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Friends
      </Link>

      {/* New Group DM button */}
      <button
        onClick={() => setShowCreateGroup(true)}
        aria-label="New Group DM"
        className="mx-2 mt-1 px-3 py-2 rounded flex items-center gap-2 text-text-secondary hover:bg-white/5 hover:text-text-primary text-sm"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
        New Group DM
      </button>

      <div className="px-2 pt-3">
        <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider px-2 mb-1">
          Direct Messages
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 min-h-0">
        {fetchError && dms.length === 0 && (
          <div className="px-2 py-4 text-center">
            <p className="text-error text-sm mb-2">Failed to load conversations</p>
            <button onClick={fetchDms} className="text-sm text-primary hover:text-primary-hover">Retry</button>
          </div>
        )}
        {!fetchError && dms.length === 0 && (
          <div className="px-4 py-6 text-center text-text-muted text-sm">
            No conversations yet. Search for a user to start chatting!
          </div>
        )}
        {dms.filter((dm) => {
          if (!search) return true;
          const { displayName } = getDmDisplay(dm);
          return displayName.toLowerCase().includes(search.toLowerCase());
        }).map((dm) => {
          const { displayName, subtitle, isGroup, otherIds } = getDmDisplay(dm);
          const otherId = !isGroup && otherIds.length > 0 ? otherIds[0] : null;
          const otherUser = otherId ? users[otherId] : null;
          const presenceStatus = otherId ? (statuses[otherId] ?? 'offline') : undefined;

          const unread = unreadCounts[dm.id] ?? 0;

          return (
            <Link
              key={dm.id}
              to={`/dm/${dm.id}`}
              onClick={() => onDmSelect?.()}
              onContextMenu={(e) => handleContextMenu(dm, e)}
              className={`w-full px-2 py-1.5 rounded flex items-center gap-2 text-sm text-left cursor-pointer transition-colors no-underline ${
                dmId === dm.id
                  ? 'bg-white/10 text-text-primary'
                  : unread > 0
                    ? 'text-text-primary font-semibold'
                    : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
              }`}
            >
              {isGroup ? (
                /* Group DM icon */
                <div className="w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
              ) : (
                <Avatar
                  url={otherUser?.avatar_url}
                  name={displayName}
                  size={32}
                  status={presenceStatus}
                />
              )}
              <div className="flex-1 min-w-0">
                <span className="truncate block">{displayName}</span>
                {subtitle && (
                  <span className="text-[11px] text-text-muted truncate block">{subtitle}</span>
                )}
              </div>
              {unread > 0 && dmId !== dm.id && (
                <span className="min-w-[18px] h-[18px] bg-error rounded-full flex items-center justify-center px-1 shrink-0">
                  <span className="text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {showCreateGroup && (
        <CreateGroupDmDialog onClose={() => setShowCreateGroup(false)} />
      )}

      {/* Context menu */}
      {contextMenu && (() => {
        const { dm } = contextMenu;
        const otherIds = dm.members.filter((id) => id !== currentUser?.id);
        const isGroup = dm.is_group;
        const otherId = !isGroup && otherIds.length > 0 ? otherIds[0] : null;
        const friendship = otherId ? friendships.get(otherId) : undefined;

        return (
          <div
            ref={contextMenuRef}
            role="menu"
            className="fixed z-50 bg-surface border border-divider rounded-lg shadow-xl py-1 min-w-[170px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {isGroup ? (
              /* Group DM: only Leave Group */
              <button
                role="menuitem"
                className="w-full px-3 py-1.5 text-sm text-error hover:bg-error/10 text-left outline-none focus:bg-white/5"
                onClick={() => { setConfirmAction({ type: 'leave', dm }); setContextMenu(null); }}
              >
                Leave Group
              </button>
            ) : (
              /* 1-on-1 DM */
              <>
                <button
                  role="menuitem"
                  className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary text-left outline-none focus:bg-white/5"
                  onClick={() => handleViewProfile(dm)}
                >
                  View Profile
                </button>

                {friendship?.status === 'accepted' ? (
                  <button
                    role="menuitem"
                    className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary text-left outline-none focus:bg-white/5"
                    onClick={() => otherId && handleRemoveFriend(otherId)}
                  >
                    Remove Friend
                  </button>
                ) : !friendship ? (
                  <button
                    role="menuitem"
                    className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary text-left outline-none focus:bg-white/5"
                    onClick={() => otherId && handleAddFriend(otherId)}
                  >
                    Add Friend
                  </button>
                ) : null}

                <div className="my-1 border-t border-divider" />

                <button
                  role="menuitem"
                  className="w-full px-3 py-1.5 text-sm text-error hover:bg-error/10 text-left outline-none focus:bg-white/5"
                  onClick={() => { setConfirmAction({ type: 'block', dm }); setContextMenu(null); }}
                >
                  Block User
                </button>
                <button
                  role="menuitem"
                  className="w-full px-3 py-1.5 text-sm text-error hover:bg-error/10 text-left outline-none focus:bg-white/5"
                  onClick={() => { setConfirmAction({ type: 'close', dm }); setContextMenu(null); }}
                >
                  Close DM
                </button>
              </>
            )}
          </div>
        );
      })()}

      {/* Confirm dialogs for block / close / leave */}
      {confirmAction?.type === 'block' && (() => {
        const otherIds = confirmAction.dm.members.filter((id) => id !== currentUser?.id);
        const otherUser = otherIds[0] ? users[otherIds[0]] : null;
        const name = otherUser?.username ?? 'this user';
        return (
          <ConfirmDialog
            title="Block User"
            message={`Are you sure you want to block ${name}? They won't be able to message you.`}
            confirmLabel={actionLoading ? 'Blocking...' : 'Block'}
            danger
            onConfirm={handleConfirmAction}
            onCancel={() => setConfirmAction(null)}
          />
        );
      })()}

      {confirmAction?.type === 'close' && (
        <ConfirmDialog
          title="Close DM"
          message="Close this conversation? You can reopen it later by starting a new DM."
          confirmLabel={actionLoading ? 'Closing...' : 'Close DM'}
          danger
          onConfirm={handleConfirmAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {confirmAction?.type === 'leave' && (() => {
        const displayName = confirmAction.dm.name || 'this group';
        return (
          <ConfirmDialog
            title="Leave Group"
            message={`Are you sure you want to leave ${displayName}? You won't be able to rejoin unless added back.`}
            confirmLabel={actionLoading ? 'Leaving...' : 'Leave Group'}
            danger
            onConfirm={handleConfirmAction}
            onCancel={() => setConfirmAction(null)}
          />
        );
      })()}

      {/* User profile card */}
      {profileTarget && (
        <UserProfileCard
          userId={profileTarget.userId}
          user={users[profileTarget.userId]}
          anchor={profileTarget.anchor}
          onClose={() => setProfileTarget(null)}
        />
      )}
    </div>
  );
}
