import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Friendship, User } from '../../api/types';
import * as api from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { usePresenceStore } from '../../stores/presence';
import Avatar from '../../components/Avatar';
import UserProfileCard from '../../components/UserProfileCard';
import { useMobileNav } from '../../hooks/useMobileNav';

type Tab = 'all' | 'pending' | 'add';

export default function Friends() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const statuses = usePresenceStore((s) => s.statuses);
  const setBulk = usePresenceStore((s) => s.setBulk);
  const [tab, setTab] = useState<Tab>('all');
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [pending, setPending] = useState<Friendship[]>([]);
  const [userCache, setUserCache] = useState<Record<string, User>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const fetchedIdsRef = useRef(new Set<string>());
  const [profileTarget, setProfileTarget] = useState<{ userId: string; user?: User; anchor: { x: number; y: number } } | null>(null);
  const { setShowSidebar, isMobile } = useMobileNav();

  // On mobile, Friends page shows content by default
  useEffect(() => {
    if (isMobile) setShowSidebar(false);
  }, [isMobile, setShowSidebar]);

  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendsError, setFriendsError] = useState('');

  const fetchFriendsData = () => {
    setFriendsLoading(true);
    setFriendsError('');
    Promise.all([
      api.getFriends().then(setFriends),
      api.getPendingFriends().then(setPending),
    ])
      .catch((e) => {
        console.warn('Failed to load friends:', e);
        setFriendsError('Failed to load friends list');
      })
      .finally(() => setFriendsLoading(false));
  };

  useEffect(() => {
    fetchFriendsData();
  }, []);

  // Fetch user info + presence for friends
  useEffect(() => {
    const ids = new Set<string>();
    friends.forEach((f) => { ids.add(f.requester_id); ids.add(f.addressee_id); });
    pending.forEach((f) => { ids.add(f.requester_id); ids.add(f.addressee_id); });
    const newIds: string[] = [];
    ids.forEach((id) => {
      if (!fetchedIdsRef.current.has(id)) {
        fetchedIdsRef.current.add(id);
        newIds.push(id);
        api.getUser(id).then((u) => setUserCache((prev) => ({ ...prev, [u.id]: u }))).catch(() => {});
      }
    });
    // Query presence for all friend IDs
    if (newIds.length > 0) {
      api.queryPresence(newIds).then((result) => {
        if (result) setBulk(result);
      }).catch(() => {});
    }
  }, [friends, pending, setBulk]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const results = await api.searchUsers(searchQuery.trim());
      setSearchResults(results.filter((u) => u.id !== user?.id));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSendRequest = async (userId: string) => {
    setActionLoading((prev) => new Set(prev).add(userId));
    try {
      await api.sendFriendRequest(userId);
      setError('');
      fetchFriendsData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionLoading((prev) => { const next = new Set(prev); next.delete(userId); return next; });
    }
  };

  const handleAccept = async (id: string) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try {
      await api.acceptFriend(id);
      fetchFriendsData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionLoading((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const handleDecline = async (id: string) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try {
      await api.declineFriend(id);
      fetchFriendsData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionLoading((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const getFriendUser = (f: Friendship): User | undefined => {
    const otherId = f.requester_id === user?.id ? f.addressee_id : f.requester_id;
    return userCache[otherId];
  };

  return (
    <>
      <div className="flex-1 flex flex-col bg-bg min-h-0">
          {/* Header with tabs */}
          <div className="h-12 px-4 flex items-center gap-4 border-b border-divider shrink-0 overflow-x-auto">
            {isMobile && (
              <button onClick={() => setShowSidebar(true)} className="text-text-secondary hover:text-text-primary shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <svg className="w-5 h-5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-text-primary font-semibold shrink-0">Friends</span>
            <div className="w-px h-6 bg-divider shrink-0" />
            {(['all', 'pending', 'add'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded text-sm capitalize whitespace-nowrap shrink-0 ${
                  tab === t ? 'bg-white/10 text-text-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t === 'add' ? 'Add Friend' : t}
                {t === 'pending' && pending.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-error rounded-full text-[10px] text-white">
                    {pending.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {error && <div className="bg-error/10 text-error text-sm p-3 rounded mb-4">{error}</div>}
            {friendsError && (
              <div className="bg-error/10 text-error text-sm p-3 rounded mb-4 flex items-center justify-between">
                <span>{friendsError}</span>
                <button onClick={fetchFriendsData} className="text-primary hover:text-primary-hover text-sm ml-2">Retry</button>
              </div>
            )}
            {friendsLoading && friends.length === 0 && pending.length === 0 && (
              <div className="space-y-2 py-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 animate-pulse">
                    <div className="w-9 h-9 rounded-full bg-white/5 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-white/5 rounded w-24" />
                      <div className="h-2.5 bg-white/5 rounded w-16" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'all' && (
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">
                  All Friends — {friends.length}
                </div>
                {friends.map((f) => {
                  const friendUser = getFriendUser(f);
                  const friendId = f.requester_id === user?.id ? f.addressee_id : f.requester_id;
                  return (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-white/5">
                      <button
                        className="cursor-pointer shrink-0"
                        onClick={(e) => setProfileTarget({ userId: friendId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                      >
                        <Avatar url={friendUser?.avatar_url} name={friendUser?.username ?? '?'} size={36} status={statuses[friendId] ?? 'offline'} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <button
                          className="text-sm text-text-primary hover:underline cursor-pointer"
                          onClick={(e) => setProfileTarget({ userId: friendId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                        >
                          {friendUser?.username ?? 'Unknown'}
                        </button>
                        <div className="text-[11px] text-text-muted capitalize">{statuses[friendId] ?? 'offline'}</div>
                      </div>
                      <button
                        onClick={async () => {
                          if (friendUser) {
                            const dm = await api.openDm(friendUser.id);
                            navigate(`/dm/${dm.id}`);
                          }
                        }}
                        className="text-text-secondary hover:text-text-primary p-2 rounded hover:bg-white/10"
                        title="Message"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
                {friends.length === 0 && (
                  <div className="text-center text-text-muted py-8">No friends yet. Add some!</div>
                )}
              </div>
            )}

            {tab === 'pending' && (
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">
                  Pending — {pending.length}
                </div>
                {pending.map((f) => {
                  const friendUser = getFriendUser(f);
                  const isIncoming = f.addressee_id === user?.id;
                  const pendingId = f.requester_id === user?.id ? f.addressee_id : f.requester_id;
                  return (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-white/5">
                      <button
                        className="cursor-pointer shrink-0"
                        onClick={(e) => setProfileTarget({ userId: pendingId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                      >
                        <Avatar url={friendUser?.avatar_url} name={friendUser?.username ?? '?'} size={36} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <button
                          className="text-sm text-text-primary hover:underline cursor-pointer"
                          onClick={(e) => setProfileTarget({ userId: pendingId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                        >
                          {friendUser?.username ?? 'Unknown'}
                        </button>
                        <div className="text-[11px] text-text-muted">
                          {isIncoming ? 'Incoming request' : 'Outgoing request'}
                        </div>
                      </div>
                      {isIncoming ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleAccept(f.id)}
                            disabled={actionLoading.has(f.id)}
                            className="p-2 rounded-full hover:bg-online/20 text-online disabled:opacity-50"
                            title="Accept"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDecline(f.id)}
                            disabled={actionLoading.has(f.id)}
                            className="p-2 rounded-full hover:bg-error/20 text-error disabled:opacity-50"
                            title="Decline"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDecline(f.id)}
                          className="px-3 py-1 text-xs text-text-secondary hover:text-error hover:bg-error/10 rounded"
                          title="Cancel Request"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  );
                })}
                {pending.length === 0 && (
                  <div className="text-center text-text-muted py-8">No pending requests</div>
                )}
              </div>
            )}

            {tab === 'add' && (
              <div>
                <div className="text-text-primary font-semibold mb-2">Add Friend</div>
                <p className="text-text-secondary text-sm mb-4">Search for a user by username</p>
                <div className="flex gap-2 mb-4">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Enter a username"
                    className="flex-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
                  />
                  <button
                    onClick={handleSearch}
                    className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded"
                  >
                    Search
                  </button>
                </div>
                <div className="space-y-1">
                  {searchResults.map((u) => (
                    <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-white/5">
                      <button
                        className="cursor-pointer shrink-0"
                        onClick={(e) => setProfileTarget({ userId: u.id, user: u, anchor: { x: e.clientX, y: e.clientY } })}
                      >
                        <Avatar url={u.avatar_url} name={u.username} size={36} />
                      </button>
                      <div className="flex-1">
                        <button
                          className="text-sm text-text-primary hover:underline cursor-pointer"
                          onClick={(e) => setProfileTarget({ userId: u.id, user: u, anchor: { x: e.clientX, y: e.clientY } })}
                        >
                          {u.username}
                        </button>
                      </div>
                      <button
                        onClick={() => handleSendRequest(u.id)}
                        className="px-3 py-1 bg-primary hover:bg-primary-hover text-white text-xs rounded"
                      >
                        Send Request
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

      {profileTarget && (
        <UserProfileCard
          userId={profileTarget.userId}
          user={profileTarget.user}
          anchor={profileTarget.anchor}
          onClose={() => setProfileTarget(null)}
        />
      )}
    </>
  );
}
