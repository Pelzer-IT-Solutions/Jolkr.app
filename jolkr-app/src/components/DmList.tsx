import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { DmChannel, Friendship, User } from '../api/types';
import { useAuthStore } from '../stores/auth';
import { useServersStore } from '../stores/servers';
import SectionHeader from './ui/SectionHeader';
import EmptyState from './ui/EmptyState';
import { MessageCircle } from 'lucide-react';
import { useUnreadStore } from '../stores/unread';
import { usePresenceStore } from '../stores/presence';
import { wsClient } from '../api/ws';
import * as api from '../api/client';
import Avatar from './Avatar';
import UserProfileCard from './UserProfileCard';
import ConfirmDialog from './dialogs/ConfirmDialog';
import CreateGroupDmDialog from './dialogs/CreateGroupDm';
import DmItem, { getDmDisplay } from './DmItem';
import { useContextMenuStore } from '../stores/context-menu';
import type { ContextMenuEntry } from '../stores/context-menu';
import { Search, Users, UserPlus } from 'lucide-react';

export interface DmListProps {
  onDmSelect?: () => void;
}

// Module-level cache — survives component unmount/remount so the list
// doesn't flash empty when navigating back from a server view.
let dmCache: DmChannel[] = [];
let userCache: Record<string, User> = {};
let fetchedUserIds = new Set<string>();

export default function DmList({ onDmSelect }: DmListProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { dmId } = useParams();
  const isOnFriends = location.pathname === '/friends';
  const currentUser = useAuthStore((s) => s.user);
  const unreadCounts = useUnreadStore((s) => s.counts);
  const statuses = usePresenceStore((s) => s.statuses);

  const [dms, setDms] = useState<DmChannel[]>(dmCache);
  const [users, setUsers] = useState<Record<string, User>>(userCache);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wsDebouncerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [friendships, setFriendships] = useState<Map<string, { id: string; status: string }>>(new Map());
  const [confirmAction, setConfirmAction] = useState<{ type: 'block' | 'leave' | 'close'; dm: DmChannel } | null>(null);
  const [profileTarget, setProfileTarget] = useState<{ userId: string; anchor: { x: number; y: number } } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDms = useCallback(() => {
    api.getDms().then((channels) => {
      setFetchError(false);
      // Only update state if the DM list actually changed (order, members, name)
      const changed = channels.length !== dmCache.length ||
        channels.some((ch, i) => {
          const cached = dmCache[i];
          if (!cached) return true;
          return ch.id !== cached.id || ch.name !== cached.name ||
            ch.members.length !== cached.members.length ||
            ch.members.some((m, j) => m !== cached.members[j]);
        });
      if (changed) {
        dmCache = channels;
        setDms(channels);
      }
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
        if (id !== currentUser?.id && !fetchedUserIds.has(id)) {
          fetchedUserIds.add(id);
          idsToFetch.push(id);
        }
      }));
      if (idsToFetch.length > 0) {
        api.getUsersBatch(idsToFetch).then((fetchedUsers) => {
          const map: Record<string, typeof fetchedUsers[0]> = {};
          for (const u of fetchedUsers) map[u.id] = u;
          setUsers((prev) => {
            const next = { ...prev, ...map };
            userCache = next;
            return next;
          });
        }).catch(() => {
          // Fallback: fetch users individually
          Promise.all(idsToFetch.map((id) => api.getUser(id).catch(() => null))).then((results) => {
            const map: Record<string, User> = {};
            for (const u of results) if (u) map[u.id] = u;
            setUsers((prev) => {
              const next = { ...prev, ...map };
              userCache = next;
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
        const otherId = f.requester_id === currentUser?.id ? f.addressee_id : f.requester_id;
        map.set(otherId, { id: f.id, status: f.status });
      }
      setFriendships(map);
    }).catch(() => {});
  }, [currentUser?.id]);

  const refreshFriendships = useCallback(async () => {
    const [friends, pending] = await Promise.all([api.getFriends(), api.getPendingFriends()]);
    const map = new Map<string, { id: string; status: string }>();
    for (const f of [...friends, ...pending]) {
      const otherId = f.requester_id === currentUser?.id ? f.addressee_id : f.requester_id;
      map.set(otherId, { id: f.id, status: f.status });
    }
    setFriendships(map);
  }, [currentUser?.id]);

  // Context menu handler — builds items and opens the singleton context menu
  const handleContextMenu = useCallback((dm: DmChannel, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const otherIds = dm.members.filter((id) => id !== currentUser?.id);
    const otherId = !dm.is_group && otherIds.length > 0 ? otherIds[0] : null;
    const friendship = otherId ? (friendships.get(otherId) ?? null) : null;

    const items: ContextMenuEntry[] = [];

    if (dm.is_group) {
      items.push({
        label: 'Leave Group', icon: 'LogOut', variant: 'danger',
        onClick: () => setConfirmAction({ type: 'leave', dm }),
      });
    } else {
      items.push({
        label: 'View Profile', icon: 'User',
        onClick: () => {
          if (otherId) {
            setProfileTarget({ userId: otherId, anchor: { x: e.clientX, y: e.clientY } });
          }
        },
      });

      if (friendship?.status === 'accepted') {
        items.push({
          label: 'Remove Friend', icon: 'UserMinus',
          onClick: async () => {
            if (!otherId) return;
            const f = friendships.get(otherId);
            if (!f) return;
            try {
              await api.declineFriend(f.id);
              setFriendships((prev) => { const next = new Map(prev); next.delete(otherId); return next; });
            } catch (err) { console.warn('Failed to remove friend:', err); }
          },
        });
      } else if (!friendship) {
        items.push({
          label: 'Add Friend', icon: 'UserPlus',
          onClick: async () => {
            if (!otherId) return;
            try {
              await api.sendFriendRequest(otherId);
              await refreshFriendships();
            } catch (err) { console.warn('Failed to send friend request:', err); }
          },
        });
      }

      items.push({ divider: true });
      items.push({
        label: 'Block User', icon: 'Ban', variant: 'danger',
        onClick: () => setConfirmAction({ type: 'block', dm }),
      });
      items.push({
        label: 'Close DM', icon: 'X', variant: 'danger',
        onClick: () => setConfirmAction({ type: 'close', dm }),
      });
    }

    useContextMenuStore.getState().open(e.clientX, e.clientY, items);
  }, [currentUser?.id, friendships, refreshFriendships]);

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    try {
      if (confirmAction.type === 'block') {
        const otherIds = confirmAction.dm.members.filter((id) => id !== currentUser?.id);
        if (otherIds[0]) {
          await api.blockUser(otherIds[0]);
          await refreshFriendships();
        }
      } else if (confirmAction.type === 'close') {
        await api.closeDm(confirmAction.dm.id);
        fetchDms();
        if (dmId === confirmAction.dm.id) {
          navigate('/friends');
        }
      } else if (confirmAction.type === 'leave') {
        await api.leaveDm(confirmAction.dm.id);
        fetchDms();
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

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="hidden md:flex px-4 pt-4 pb-3 gap-3 flex-col shrink-0">
        <h2 className="text-base font-bold text-text-primary">Direct Messages</h2>
      </div>

      {/* Search bar */}
      <div className="px-4">
        <div
          className="rounded-xl md:rounded-lg bg-panel px-4 py-2.5 md:px-3 md:py-2 gap-2 flex items-center border border-divider focus-within:border-border-accent transition-colors"
        >
          <Search className="size-4.5 md:size-4 text-text-tertiary shrink-0" />
          <input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search conversations"
            className="input-reset w-full bg-transparent text-sm text-text-tertiary outline-none"
          />
        </div>
      </div>

      {/* User search results for starting new DMs */}
      <div className="relative">
        {search.trim().length >= 2 && searchResults.length > 0 && (
          <div className="absolute left-0 right-0 top-0 z-20 bg-sidebar border border-divider rounded-lg mx-2 mt-1 py-1 shadow-lg animate-dropdown-enter">
            <div className="text-2xs font-bold text-text-tertiary uppercase tracking-wider px-3 py-1">Start a conversation</div>
            {searchResults.slice(0, 5).map((u) => (
              <button
                key={u.id}
                onClick={() => startDm(u.id)}
                className="w-full px-4 py-2 rounded flex items-center gap-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary"
              >
                <Avatar url={u.avatar_url} name={u.display_name || u.username} size={28} userId={u.id} />
                <span className="truncate">{u.display_name || u.username}</span>
              </button>
            ))}
          </div>
        )}
        {search.trim().length >= 2 && searching && (
          <div className="px-4 pt-2 text-xs text-text-tertiary">Searching users...</div>
        )}
        {startDmError && (
          <div className="mx-2 mt-1 px-3 py-1.5 bg-danger/10 text-danger text-xs rounded">{startDmError}</div>
        )}
      </div>

      {/* Nav section */}
      <div className="px-2 py-1 gap-0.5 flex flex-col">
        <Link
          to="/friends"
          onClick={() => onDmSelect?.()}
          aria-label="Friends"
          className={`rounded-lg px-3 py-2.5 gap-2.5 flex items-center font-medium text-sm cursor-pointer no-underline ${
            isOnFriends ? 'bg-active text-text-primary' : 'text-text-secondary hover:bg-hover'
          }`}
        >
          <Users className="size-5" />
          Friends
        </Link>

        <button
          onClick={() => setShowCreateGroup(true)}
          aria-label="New Group DM"
          className="rounded-lg px-3 py-2.5 gap-2.5 flex items-center text-text-secondary font-medium hover:bg-hover text-sm"
        >
          <UserPlus className="size-5" />
          New Group DM
        </button>
      </div>

      <div className="px-4 pt-3 pb-1">
        <SectionHeader>Direct Messages</SectionHeader>
      </div>

      <div className="flex-1 overflow-y-auto px-2 gap-0.5 flex flex-col min-h-0">
        {fetchError && dms.length === 0 && (
          <div className="px-2 py-4 text-center">
            <p className="text-danger text-sm mb-2">Failed to load conversations</p>
            <button onClick={fetchDms} className="text-sm text-accent hover:text-accent-hover">Retry</button>
          </div>
        )}
        {!fetchError && dms.length === 0 && (
          <EmptyState
            icon={<MessageCircle className="size-8" />}
            title="No conversations yet."
            description="Search for a user to start chatting!"
          />
        )}
        {dms.filter((dm) => {
          if (!search) return true;
          const { displayName } = getDmDisplay(dm, users, currentUser?.id ?? '');
          return displayName.toLowerCase().includes(search.toLowerCase());
        }).map((dm) => {
          const otherIds = dm.members.filter((id) => id !== currentUser?.id);
          const otherId = !dm.is_group && otherIds.length > 0 ? otherIds[0] : null;
          const presenceStatus = otherId ? (statuses[otherId] ?? 'offline') : undefined;

          return (
            <DmItem
              key={dm.id}
              dm={dm}
              users={users}
              currentUserId={currentUser?.id ?? ''}
              isActive={dmId === dm.id}
              unreadCount={unreadCounts[dm.id] ?? 0}
              status={presenceStatus}
              onClick={onDmSelect}
              onContextMenu={handleContextMenu}
            />
          );
        })}
      </div>

      {showCreateGroup && (
        <CreateGroupDmDialog onClose={() => setShowCreateGroup(false)} />
      )}

      {/* Confirm dialogs for block / close / leave */}
      {confirmAction?.type === 'block' && (() => {
        const otherIds = confirmAction.dm.members.filter((id) => id !== currentUser?.id);
        const otherUser = otherIds[0] ? users[otherIds[0]] : null;
        const name = (otherUser?.display_name || otherUser?.username) ?? 'this user';
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
