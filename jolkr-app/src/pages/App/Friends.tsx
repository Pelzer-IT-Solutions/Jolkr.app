import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Friendship, User } from '../../api/types';
import * as api from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { usePresenceStore } from '../../stores/presence';
import Avatar from '../../components/Avatar';
import UserProfileCard from '../../components/UserProfileCard';
import { useMobileNav } from '../../hooks/useMobileNav';
import { Users, MessageCircle, Check, X, UserPlus } from 'lucide-react';

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

  if (isMobile) {
    return (
      <>
        <div className="flex-1 flex flex-col bg-panel min-h-0">
          {/* Mobile Header */}
          <div className="px-4 pt-2 pb-4 flex items-center justify-between shrink-0">
            <span className="text-2xl font-bold text-text-primary">Friends</span>
          </div>

          {/* Mobile Tabs row */}
          <div className="flex border-b border-border-subtle shrink-0">
            {(['all', 'pending', 'add'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm whitespace-nowrap ${
                  tab === t
                    ? 'font-semibold text-text-primary border-b-2 border-accent'
                    : 'font-medium text-text-tertiary'
                }`}
              >
                {t === 'add' ? 'Add Friend' : t === 'all' ? 'All' : 'Pending'}
                {t === 'pending' && pending.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-danger rounded-full text-2xs text-white">
                    {pending.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-col flex-1 overflow-y-auto min-h-0">
            {error && <div className="bg-danger/10 text-danger text-sm p-3 mx-4 mt-2 rounded">{error}</div>}
            {friendsError && (
              <div className="bg-danger/10 text-danger text-sm p-3 mx-4 mt-2 rounded flex items-center justify-between">
                <span>{friendsError}</span>
                <button onClick={fetchFriendsData} className="text-accent hover:text-accent-hover text-sm ml-2">Retry</button>
              </div>
            )}
            {friendsLoading && friends.length === 0 && pending.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 rounded-full border-2 border-divider border-t-text-tertiary animate-spin" />
              </div>
            )}

            {tab === 'all' && (
              <div>
                <div className="px-4 py-2 text-xs font-semibold text-text-tertiary tracking-wider uppercase">
                  All Friends — {friends.length}
                </div>
                {friends.map((f, idx) => {
                  const friendUser = getFriendUser(f);
                  const friendId = f.requester_id === user?.id ? f.addressee_id : f.requester_id;
                  const isLast = idx === friends.length - 1;
                  const friendStatus = statuses[friendId] ?? 'offline';
                  return (
                    <div key={f.id} className={`px-4 py-2.5 gap-3 flex items-center ${!isLast ? 'border-b border-border-subtle' : ''}`}>
                      <button
                        className="cursor-pointer shrink-0"
                        onClick={(e) => setProfileTarget({ userId: friendId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                      >
                        <Avatar url={friendUser?.avatar_url} name={friendUser?.username ?? '?'} size={40} status={friendStatus} userId={friendId} />
                      </button>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <button
                          className="text-base font-semibold text-text-primary text-left"
                          onClick={(e) => setProfileTarget({ userId: friendId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                        >
                          {friendUser?.username ?? 'Unknown'}
                        </button>
                        <div className={`text-xs capitalize ${friendStatus === 'online' ? 'text-online' : 'text-text-tertiary'}`}>
                          {friendStatus}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (friendUser) {
                            const dm = await api.openDm(friendUser.id);
                            navigate(`/dm/${dm.id}`);
                          }
                        }}
                        className="ml-auto text-text-secondary"
                        title="Message"
                      >
                        <MessageCircle className="size-5" />
                      </button>
                    </div>
                  );
                })}
                {friends.length === 0 && (
                  <div className="text-center text-text-tertiary py-8">No friends yet. Add some!</div>
                )}
              </div>
            )}

            {tab === 'pending' && (
              <div>
                <div className="px-4 py-2 text-xs font-semibold text-text-tertiary tracking-wider uppercase">
                  Pending — {pending.length}
                </div>
                {pending.map((f, idx) => {
                  const friendUser = getFriendUser(f);
                  const isIncoming = f.addressee_id === user?.id;
                  const pendingId = f.requester_id === user?.id ? f.addressee_id : f.requester_id;
                  const isLast = idx === pending.length - 1;
                  return (
                    <div key={f.id} className={`px-4 py-2.5 gap-3 flex items-center ${!isLast ? 'border-b border-border-subtle' : ''}`}>
                      <button
                        className="cursor-pointer shrink-0"
                        onClick={(e) => setProfileTarget({ userId: pendingId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                      >
                        <Avatar url={friendUser?.avatar_url} name={friendUser?.username ?? '?'} size={40} userId={pendingId} />
                      </button>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <button
                          className="text-base font-semibold text-text-primary text-left"
                          onClick={(e) => setProfileTarget({ userId: pendingId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                        >
                          {friendUser?.username ?? 'Unknown'}
                        </button>
                        <div className="text-xs text-text-tertiary">
                          {isIncoming ? 'Incoming Friend Request' : 'Outgoing Friend Request'}
                        </div>
                      </div>
                      {isIncoming ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAccept(f.id)}
                            disabled={actionLoading.has(f.id)}
                            className="size-9 rounded-full bg-surface flex items-center justify-center text-online disabled:opacity-50 hover:bg-hover"
                            title="Accept"
                          >
                            <Check className="size-5" />
                          </button>
                          <button
                            onClick={() => handleDecline(f.id)}
                            disabled={actionLoading.has(f.id)}
                            className="size-9 rounded-full bg-surface flex items-center justify-center text-danger disabled:opacity-50 hover:bg-hover"
                            title="Decline"
                          >
                            <X className="size-5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDecline(f.id)}
                          className="size-9 rounded-full bg-surface flex items-center justify-center text-text-secondary hover:text-danger hover:bg-hover"
                          title="Cancel Request"
                        >
                          <X className="size-5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {pending.length === 0 && (
                  <div className="text-center text-text-tertiary py-8">No pending requests</div>
                )}
              </div>
            )}

            {tab === 'add' && (
              <div className="flex flex-col gap-5 flex-1 px-4 py-5">
                <p className="text-sm text-text-secondary">You can add friends by their username.</p>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Enter a username..."
                  className="w-full px-4 py-3.5 bg-panel border border-divider rounded-xl text-text-primary text-sm"
                />
                <button
                  onClick={handleSearch}
                  className="btn-primary text-sm w-full"
                >
                  Send Friend Request
                </button>
                {searchResults.length > 0 ? (
                  <div className="flex flex-col">
                    {searchResults.map((u, idx) => {
                      const isLast = idx === searchResults.length - 1;
                      return (
                        <div key={u.id} className={`py-3 px-4 gap-3 flex items-center justify-between ${!isLast ? 'border-b border-border-subtle' : ''}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <button
                              className="cursor-pointer shrink-0"
                              onClick={(e) => setProfileTarget({ userId: u.id, user: u, anchor: { x: e.clientX, y: e.clientY } })}
                            >
                              <Avatar url={u.avatar_url} name={u.username} size={40} userId={u.id} />
                            </button>
                            <button
                              className="text-sm font-semibold text-text-primary text-left truncate"
                              onClick={(e) => setProfileTarget({ userId: u.id, user: u, anchor: { x: e.clientX, y: e.clientY } })}
                            >
                              {u.username}
                            </button>
                          </div>
                          <button
                            onClick={() => handleSendRequest(u.id)}
                            disabled={actionLoading.has(u.id)}
                            className="text-sm font-semibold text-accent shrink-0 disabled:opacity-50"
                          >
                            Add
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center flex-1 gap-4">
                    <UserPlus className="size-16 text-text-tertiary opacity-40" />
                    <span className="text-base font-semibold text-text-secondary">No one around to chat with?</span>
                    <span className="text-sm text-text-tertiary">Send a friend request to start chatting!</span>
                  </div>
                )}
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

  return (
    <>
      <div className="flex-1 flex flex-col bg-panel min-h-0">
          {/* Header with tabs */}
          <div className="bg-panel px-5 py-3 gap-4 flex items-center border-b border-border-subtle shrink-0 overflow-x-auto">
            <Users className="size-5 text-text-secondary shrink-0" />
            <span className="text-base font-bold text-text-primary shrink-0">Friends</span>
            <div className="w-px h-5 bg-divider shrink-0" />
            {(['all', 'pending', 'add'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3.5 py-1.5 rounded-lg text-sm capitalize whitespace-nowrap shrink-0 ${
                  tab === t
                    ? 'bg-accent-muted font-semibold text-accent'
                    : t === 'add'
                      ? 'font-medium text-accent hover:bg-hover'
                      : 'font-medium text-text-secondary hover:bg-hover'
                }`}
              >
                {t === 'add' ? 'Add Friend' : t}
                {t === 'pending' && pending.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-danger rounded-full text-2xs text-white">
                    {pending.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="px-5 py-4 flex flex-col flex-1 overflow-y-auto min-h-0">
            {error && <div className="bg-danger/10 text-danger text-sm p-3 rounded mb-4">{error}</div>}
            {friendsError && (
              <div className="bg-danger/10 text-danger text-sm p-3 rounded mb-4 flex items-center justify-between">
                <span>{friendsError}</span>
                <button onClick={fetchFriendsData} className="text-accent hover:text-accent-hover text-sm ml-2">Retry</button>
              </div>
            )}
            {friendsLoading && friends.length === 0 && pending.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 rounded-full border-2 border-divider border-t-text-tertiary animate-spin" />
              </div>
            )}

            {tab === 'all' && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                  All Friends — {friends.length}
                </div>
                {friends.map((f) => {
                  const friendUser = getFriendUser(f);
                  const friendId = f.requester_id === user?.id ? f.addressee_id : f.requester_id;
                  return (
                    <div key={f.id} className="rounded-lg px-4 py-3 gap-3 flex items-center hover:bg-hover">
                      <button
                        className="cursor-pointer shrink-0"
                        onClick={(e) => setProfileTarget({ userId: friendId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                      >
                        <Avatar url={friendUser?.avatar_url} name={friendUser?.username ?? '?'} size={40} status={statuses[friendId] ?? 'offline'} userId={friendId} />
                      </button>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <button
                          className="text-sm font-semibold text-text-primary hover:underline cursor-pointer text-left"
                          onClick={(e) => setProfileTarget({ userId: friendId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                        >
                          {friendUser?.username ?? 'Unknown'}
                        </button>
                        <div className="text-xs text-text-tertiary capitalize">{statuses[friendId] ?? 'offline'}</div>
                      </div>
                      <button
                        onClick={async () => {
                          if (friendUser) {
                            const dm = await api.openDm(friendUser.id);
                            navigate(`/dm/${dm.id}`);
                          }
                        }}
                        className="p-2 rounded-full bg-surface flex items-center justify-center text-text-secondary"
                        title="Message"
                      >
                        <MessageCircle className="size-5" />
                      </button>
                    </div>
                  );
                })}
                {friends.length === 0 && (
                  <div className="text-center text-text-tertiary py-8">No friends yet. Add some!</div>
                )}
              </div>
            )}

            {tab === 'pending' && (
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
                  Pending — {pending.length}
                </div>
                {pending.map((f, idx) => {
                  const friendUser = getFriendUser(f);
                  const isIncoming = f.addressee_id === user?.id;
                  const pendingId = f.requester_id === user?.id ? f.addressee_id : f.requester_id;
                  const isLast = idx === pending.length - 1;
                  return (
                    <div key={f.id} className={`py-3 gap-3 flex items-center ${!isLast ? 'border-b border-border-subtle' : ''}`}>
                      <button
                        className="cursor-pointer shrink-0"
                        onClick={(e) => setProfileTarget({ userId: pendingId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                      >
                        <Avatar url={friendUser?.avatar_url} name={friendUser?.username ?? '?'} size={40} userId={pendingId} />
                      </button>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <button
                          className="text-sm font-semibold text-text-primary hover:underline cursor-pointer text-left"
                          onClick={(e) => setProfileTarget({ userId: pendingId, user: friendUser, anchor: { x: e.clientX, y: e.clientY } })}
                        >
                          {friendUser?.username ?? 'Unknown'}
                        </button>
                        <div className="text-xs text-text-secondary">
                          {isIncoming ? 'Incoming Friend Request' : 'Outgoing Friend Request'}
                        </div>
                      </div>
                      {isIncoming ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAccept(f.id)}
                            disabled={actionLoading.has(f.id)}
                            className="size-9 rounded-full bg-surface flex items-center justify-center text-online disabled:opacity-50 hover:bg-hover"
                            title="Accept"
                          >
                            <Check className="size-5" />
                          </button>
                          <button
                            onClick={() => handleDecline(f.id)}
                            disabled={actionLoading.has(f.id)}
                            className="size-9 rounded-full bg-surface flex items-center justify-center text-danger disabled:opacity-50 hover:bg-hover"
                            title="Decline"
                          >
                            <X className="size-5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDecline(f.id)}
                          className="size-9 rounded-full bg-surface flex items-center justify-center text-text-secondary hover:text-danger hover:bg-hover"
                          title="Cancel Request"
                        >
                          <X className="size-5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {pending.length === 0 && (
                  <div className="text-center text-text-tertiary py-8">No pending requests</div>
                )}
              </div>
            )}

            {tab === 'add' && (
              <div className="flex flex-col gap-4 flex-1">
                <div className="flex flex-col gap-2">
                  <div className="text-base font-bold text-text-primary">Add Friend</div>
                  <p className="text-sm text-text-secondary">You can add friends with their Jolkr username.</p>
                </div>
                <div className="flex gap-3">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Enter a username#0000"
                    className="flex-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm"
                  />
                  <button
                    onClick={handleSearch}
                    className="btn-primary text-sm shrink-0"
                  >
                    Send Request
                  </button>
                </div>
                <div className="h-px bg-border-subtle" />
                {searchResults.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    {searchResults.map((u) => (
                      <div key={u.id} className="rounded-lg px-4 py-3 gap-3 flex items-center hover:bg-hover">
                        <button
                          className="cursor-pointer shrink-0"
                          onClick={(e) => setProfileTarget({ userId: u.id, user: u, anchor: { x: e.clientX, y: e.clientY } })}
                        >
                          <Avatar url={u.avatar_url} name={u.username} size={40} userId={u.id} />
                        </button>
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <button
                            className="text-sm font-semibold text-text-primary hover:underline cursor-pointer text-left"
                            onClick={(e) => setProfileTarget({ userId: u.id, user: u, anchor: { x: e.clientX, y: e.clientY } })}
                          >
                            {u.username}
                          </button>
                        </div>
                        <button
                          onClick={() => handleSendRequest(u.id)}
                          disabled={actionLoading.has(u.id)}
                          className="btn-primary text-sm shrink-0"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center flex-1 gap-4">
                    <UserPlus className="size-16 text-text-tertiary opacity-40" />
                    <span className="text-base font-semibold text-text-secondary">No one around to chat with?</span>
                    <span className="text-sm text-text-tertiary">Send a friend request to start chatting!</span>
                  </div>
                )}
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
