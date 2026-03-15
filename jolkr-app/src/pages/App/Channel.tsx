import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useServersStore } from '../../stores/servers';
import { useUnreadStore } from '../../stores/unread';
import { useMessagesStore } from '../../stores/messages';
import * as api from '../../api/client';
import type { Message, User } from '../../api/types';
import { useAuthStore } from '../../stores/auth';
import { hasPermission, SEND_MESSAGES, ATTACH_FILES } from '../../utils/permissions';
import ChannelList from '../../components/ChannelList';
import MessageList from '../../components/MessageList';
import MessageInput from '../../components/MessageInput';
import PollCreator from '../../components/PollCreator';
import MemberList from '../../components/MemberList';
import UserPanel from '../../components/UserPanel';
import InviteDialog from '../../components/dialogs/InviteDialog';
import PinnedMessagesPanel from '../../components/PinnedMessagesPanel';
import ThreadPanel from '../../components/ThreadPanel';
import ThreadListPanel from '../../components/ThreadListPanel';
import { useMobileNav } from '../../hooks/useMobileNav';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { usePresignRefresh } from '../../hooks/usePresignRefresh';
import { useVoiceStore } from '../../stores/voice';
import Avatar from '../../components/Avatar';
import { UserPlus, Upload, ChevronLeft, Mic, Search, BarChart3, MessageSquare, Bookmark, Users, X, VolumeX } from 'lucide-react';

const EMPTY_CHANNELS: import('../../api/types').Channel[] = [];
const EMPTY_MEMBERS: import('../../api/types').Member[] = [];

export default function ChannelPage() {
  const { serverId, channelId } = useParams<{ serverId: string; channelId: string }>();
  const servers = useServersStore((s) => s.servers);
  const channels = useServersStore((s) => serverId ? (s.channels[serverId] ?? EMPTY_CHANNELS) : EMPTY_CHANNELS);
  const server = servers.find((s) => s.id === serverId);
  const channel = channels.find((c) => c.id === channelId);
  const members = useServersStore((s) => serverId ? (s.members[serverId] ?? EMPTY_MEMBERS) : EMPTY_MEMBERS);
  const fetchMembers = useServersStore((s) => s.fetchMembers);
  const setActiveChannel = useUnreadStore((s) => s.setActiveChannel);
  const channelPermissions = useServersStore((s) => s.channelPermissions);
  const fetchChannelPermissions = useServersStore((s) => s.fetchChannelPermissions);
  const fetchEmojis = useServersStore((s) => s.fetchEmojis);
  const [showMembers, setShowMembers] = useState(false);
  const [showInvites, setShowInvites] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [showTopicExpanded, setShowTopicExpanded] = useState(false);
  const [nsfwAcknowledged, setNsfwAcknowledged] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [memberUsers, setMemberUsers] = useState<Record<string, User>>({});
  const fetchedMemberIdsRef = useRef(new Set<string>());
  const [isDragging, setIsDragging] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const dragCounterRef = useRef(0);
  const { showSidebar, setShowSidebar, isMobile } = useMobileNav();

  // On mobile, when navigating to a channel, show content
  useEffect(() => {
    if (isMobile && channelId) setShowSidebar(false);
  }, [channelId, isMobile, setShowSidebar]);

  // Fetch emojis for custom emoji rendering
  useEffect(() => {
    if (serverId) fetchEmojis(serverId);
  }, [serverId, fetchEmojis]);

  // Fetch members for @mentions
  useEffect(() => {
    if (serverId) {
      fetchMembers(serverId).then(() => {
        const mems = useServersStore.getState().members[serverId] ?? [];
        mems.forEach((m) => {
          if (!fetchedMemberIdsRef.current.has(m.user_id)) {
            fetchedMemberIdsRef.current.add(m.user_id);
            api.getUser(m.user_id).then((u) => {
              setMemberUsers((prev) => ({ ...prev, [u.id]: u }));
            }).catch(() => {
              fetchedMemberIdsRef.current.delete(m.user_id);
            });
          }
        });
      }).catch(() => {});
    }
  }, [serverId, fetchMembers]);

  const mentionableUsers = useMemo(() => {
    if (!serverId) return [];
    return members
      .map((m) => ({
        id: m.user_id,
        username: memberUsers[m.user_id]?.username ?? m.nickname ?? 'Unknown',
      }))
      .filter((u) => u.username !== 'Unknown');
  }, [members, memberUsers]);

  // Debounced server-side search
  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim().length < 2) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(() => {
      if (channelId) {
        // Parse filter syntax: from:user has:file before:date after:date
        const filterRegex = /(?:from|has|before|after):\S+/g;
        const filters = value.match(filterRegex) ?? [];
        const textQuery = value.replace(filterRegex, '').trim();

        const params: { q?: string; from?: string; has?: string; before?: string; after?: string } = {};
        if (textQuery) params.q = textQuery;
        for (const f of filters) {
          const [key, val] = f.split(':');
          if (key === 'from') params.from = val;
          else if (key === 'has') params.has = val;
          else if (key === 'before') params.before = new Date(val).toISOString();
          else if (key === 'after') params.after = new Date(val).toISOString();
        }

        const hasFilters = params.from || params.has || params.before || params.after;
        const searchFn = hasFilters
          ? api.searchMessagesAdvanced(channelId, params)
          : api.searchMessages(channelId, value.trim());

        searchFn
          .then((msgs) => setSearchResults(msgs.reverse()))
          .catch(() => setSearchResults(null))
          .finally(() => setSearchLoading(false));
      }
    }, 300);
  }, [channelId]);

  // Reset search, panels, and thread when channel changes
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setSearch('');
    setSearchResults(null);
    setShowSearch(false);
    setOpenThreadId(null);
    setShowPins(false);
    setShowThreads(false);
    setShowTopicExpanded(false);
    // Check NSFW acknowledgment from localStorage
    if (channelId) {
      const acked = localStorage.getItem(`nsfw_ack_${channelId}`);
      setNsfwAcknowledged(acked === 'true');
    }
  }, [channelId]);

  // Cleanup search timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // Reset reply when channel changes + mark as read
  useEffect(() => {
    setReplyTo(null);
    if (channelId) setActiveChannel(channelId);
    return () => setActiveChannel(null);
  }, [channelId, setActiveChannel]);

  useEffect(() => {
    if (serverId) {
      useServersStore.getState().fetchChannels(serverId).catch(() => {});
    }
  }, [serverId]);

  // Fetch channel-level permissions
  useEffect(() => {
    if (channelId) fetchChannelPermissions(channelId);
  }, [channelId, fetchChannelPermissions]);

  const currentUserId = useAuthStore((s) => s.user?.id);

  // Check if user is timed out
  const isTimedOut = useMemo(() => {
    if (!serverId || !currentUserId) return false;
    const myMember = members.find((m) => m.user_id === currentUserId);
    if (!myMember?.timeout_until) return false;
    return new Date(myMember.timeout_until) > new Date();
  }, [serverId, currentUserId, members]);

  // Compute whether user can send messages in this channel
  // undefined = still loading (MessageInput shows loading state), true/false = resolved
  const canSend = useMemo(() => {
    if (isTimedOut) return false;
    if (!channelId) return true;
    const perms = channelPermissions[channelId];
    if (perms === undefined) return undefined; // still loading
    return hasPermission(perms, SEND_MESSAGES);
  }, [channelId, channelPermissions, isTimedOut]);

  // Compute whether user can attach files
  const canAttach = useMemo(() => {
    if (isTimedOut) return false;
    if (!channelId) return true;
    const perms = channelPermissions[channelId];
    if (perms === undefined) return undefined;
    return hasPermission(perms, ATTACH_FILES);
  }, [channelId, channelPermissions, isTimedOut]);

  // Drag-and-drop handlers for the full chat area
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files') && canAttach !== false) {
      setIsDragging(true);
    }
  }, [canAttach]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    if (canAttach === false) return;
    const dropped = Array.from(e.dataTransfer.files);
    const valid = dropped.filter((f) => f.size <= 25 * 1024 * 1024);
    if (valid.length > 0) {
      setDroppedFiles(valid);
      // Reset after one render cycle so the effect doesn't re-fire on canAttach changes
      requestAnimationFrame(() => setDroppedFiles([]));
    }
  }, [canAttach]);

  // Periodically refresh presigned S3 URLs (every 3h)
  usePresignRefresh(channelId, false);

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    toggleSearch: useCallback(() => setShowSearch((prev) => !prev), []),
    toggleMembers: useCallback(() => setShowMembers((prev) => !prev), []),
    closeAll: useCallback(() => {
      setShowSearch(false);
      setShowPins(false);
      setShowThreads(false);
      setOpenThreadId(null);
      setShowTopicExpanded(false);
    }, []),
  });

  const handleOpenThread = useCallback(async (message: Message) => {
    if (message.thread_id) {
      // Message already has a thread — open it
      setOpenThreadId(message.thread_id);
      setShowPins(false);
      setShowThreads(false);
    } else if (channelId) {
      // Create a new thread from this message
      try {
        const result = await api.createThread(channelId, message.id);
        // Update the starter message in the channel store so thread_id + badge appear
        useMessagesStore.getState().updateMessage(channelId, result.message);
        setOpenThreadId(result.thread.id);
        setShowPins(false);
        setShowThreads(false);
      } catch (e) {
        console.warn('Failed to create thread:', (e as Error).message);
      }
    }
  }, [channelId]);

  if (!server || !channelId) return null;

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Channel list sidebar */}
        <div className={`${isMobile ? 'w-full' : 'w-65'} bg-sidebar flex flex-col shrink-0 h-full overflow-hidden${isMobile && !showSidebar ? ' hidden' : ''}`}>
          <ChannelList server={server} onChannelSelect={isMobile ? () => setShowSidebar(false) : undefined} />

          {/* Invite button */}
          <div className="border-t border-border-subtle">
            <button
              onClick={() => setShowInvites(true)}
              className="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-hover hover:text-text-primary flex items-center gap-2"
            >
              <UserPlus className="size-4" />
              Invite People
            </button>
          </div>

          <UserPanel />
        </div>

      {/* Main chat area */}
        <div
          className={`flex-1 flex flex-col bg-panel min-w-0 min-h-0 page-transition relative${isMobile && showSidebar ? ' hidden' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Full-window drop overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-50 bg-accent/10 border-2 border-dashed border-accent rounded-lg flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-2">
                <Upload className="size-10 text-accent" />
                <span className="text-accent font-semibold text-lg">Drop files to upload</span>
              </div>
            </div>
          )}
          {/* Channel header */}
          <div className="bg-panel px-5 py-3 flex items-center gap-3 border-b border-border-subtle shrink-0">
            {isMobile && (
              <button onClick={() => setShowSidebar(true)} className="text-text-secondary hover:text-text-primary mr-1" aria-label="Back to channels">
                <ChevronLeft className="size-5" />
              </button>
            )}
            {channel?.kind === 'voice' ? (
              <Mic className="size-4 text-text-tertiary shrink-0" />
            ) : (
              <span className="text-text-tertiary">#</span>
            )}
            <span className="text-base font-semibold text-text-primary">{channel?.name ?? 'channel'}</span>
            {channel?.is_nsfw && (
              <span className="px-1.5 py-0.5 text-2xs bg-danger/20 text-danger rounded font-bold uppercase shrink-0">
                NSFW
              </span>
            )}
            {channel?.topic && (
              <>
                <div className="w-px h-6 bg-divider" />
                <button
                  onClick={() => setShowTopicExpanded(!showTopicExpanded)}
                  className="text-text-tertiary text-sm truncate hover:text-text-secondary cursor-pointer text-left"
                  title="Click to expand topic"
                  aria-label="Toggle channel topic"
                  aria-expanded={showTopicExpanded}
                >
                  {channel.topic}
                </button>
              </>
            )}
            <div className="flex-1" />

            {/* Search */}
            {showSearch ? (
              <div>
              <input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                onBlur={() => { if (!search) setShowSearch(false); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearch(false); setSearch(''); setSearchResults(null); } }}
                placeholder="Search messages..."
                className={`input-reset px-3 py-1 bg-bg border border-divider rounded-lg text-sm text-text-primary ${isMobile ? 'w-32' : 'w-48'}`}
                autoFocus
              />
              </div>
            ) : (
              <button
                onClick={() => setShowSearch(true)}
                className="text-text-secondary hover:text-text-primary"
                aria-label="Search messages"
              >
                <Search className="size-5" />
              </button>
            )}

            {/* Create Poll */}
            <button
              onClick={() => setShowPollCreator(true)}
              className="text-text-secondary hover:text-text-primary"
              title="Create Poll"
              aria-label="Create Poll"
            >
              <BarChart3 className="size-5" />
            </button>

            {/* Toggle threads list */}
            <button
              onClick={() => {
                const next = !showThreads;
                setShowThreads(next);
                if (next) { setShowPins(false); setOpenThreadId(null); }
              }}
              className={`${showThreads ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
              title="Threads"
              aria-label="Threads"
            >
              <MessageSquare className="size-5" />
            </button>

            {/* Toggle pinned messages */}
            <button
              onClick={() => {
                const next = !showPins;
                setShowPins(next);
                if (next) { setShowThreads(false); setOpenThreadId(null); }
              }}
              className={`${showPins ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
              title="Pinned Messages"
              aria-label="Pinned Messages"
            >
              <Bookmark className="size-5" />
            </button>

            {/* Toggle member list */}
            <button
              onClick={() => setShowMembers(!showMembers)}
              className={`${showMembers ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
              aria-label="Toggle members"
            >
              <Users className="size-5" />
            </button>
          </div>

          {/* Expanded topic panel */}
          {showTopicExpanded && channel?.topic && (
            <>
              <div className="fixed inset-0 z-30 animate-fade-in" onClick={() => setShowTopicExpanded(false)} />
              <div className="relative z-40 px-4 py-3 bg-surface border-b border-divider animate-fade-in-down">
                <div className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-1">Channel Topic</div>
                <div className="text-text-secondary text-sm whitespace-pre-wrap">{channel.topic}</div>
              </div>
            </>
          )}

          {/* NSFW age gate */}
          {channel?.is_nsfw && !nsfwAcknowledged && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="text-4xl mb-3">🔞</div>
                <h2 className="text-text-primary text-lg font-semibold mb-2">NSFW Channel</h2>
                <p className="text-text-tertiary text-sm mb-4">
                  This channel is marked as age-restricted. You must be 18 years or older to view its content.
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => window.history.back()}
                    className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary bg-surface rounded"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={() => {
                      setNsfwAcknowledged(true);
                      localStorage.setItem(`nsfw_ack_${channelId}`, 'true');
                    }}
                    className="px-4 py-2 text-sm bg-danger hover:bg-danger/80 text-white rounded"
                  >
                    I am 18 or older
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Messages + member list + pins panel (text channels) */}
          {(!channel?.is_nsfw || nsfwAcknowledged) && channel?.kind !== 'voice' && (
          <div className="flex-1 flex min-h-0 relative">
            <div className="flex-1 flex flex-col min-w-0">
              <MessageList
                channelId={channelId}
                search={search}
                searchResults={searchResults}
                searchLoading={searchLoading}
                onReply={setReplyTo}
                onOpenThread={handleOpenThread}
              />
              <MessageInput
                channelId={channelId}
                serverId={serverId}
                replyTo={replyTo}
                replyAuthor={replyTo ? (memberUsers[replyTo.author_id] ?? null) : null}
                onCancelReply={() => setReplyTo(null)}
                mentionableUsers={mentionableUsers}
                canSend={canSend}
                canAttach={canAttach !== false}
                slowmodeSeconds={channel?.slowmode_seconds}
                droppedFiles={droppedFiles}
              />
            </div>
            {/* MemberList: overlay on mobile, inline on desktop */}
            {showMembers && serverId && (
              isMobile ? (
                <div className="fixed inset-0 z-50 flex">
                  <div className="flex-1" onClick={() => setShowMembers(false)} />
                  <div className="w-70 max-w-[80vw] bg-sidebar border-l border-divider h-full overflow-y-auto animate-slide-in-right">
                    <div className="px-5 py-3 flex items-center border-b border-divider shrink-0">
                      <span className="text-text-primary font-semibold text-sm flex-1">Members</span>
                      <button onClick={() => setShowMembers(false)} className="text-text-secondary hover:text-text-primary" aria-label="Close members">
                        <X className="size-5" />
                      </button>
                    </div>
                    <MemberList serverId={serverId} className="flex-1 overflow-y-auto" />
                  </div>
                </div>
              ) : (
                <MemberList serverId={serverId} />
              )
            )}
            {showPins && channelId && (
              <PinnedMessagesPanel channelId={channelId} onClose={() => setShowPins(false)} />
            )}
            {showThreads && channelId && (
              <ThreadListPanel
                channelId={channelId}
                onClose={() => setShowThreads(false)}
                onOpenThread={(id) => { setOpenThreadId(id); setShowThreads(false); }}
              />
            )}
            {openThreadId && channelId && (
              <ThreadPanel threadId={openThreadId} channelId={channelId} onClose={() => setOpenThreadId(null)} />
            )}
          </div>
          )}

          {/* Voice channel view */}
          {channel?.kind === 'voice' && serverId && (
            <VoiceChannelView channelId={channelId} channelName={channel.name} serverId={serverId} memberUsers={memberUsers} />
          )}
        </div>

      {showInvites && serverId && <InviteDialog serverId={serverId} onClose={() => setShowInvites(false)} />}
      {showPollCreator && channelId && (
        <PollCreator channelId={channelId} onClose={() => setShowPollCreator(false)} onCreated={() => {}} />
      )}
    </div>
  );
}

function VoiceChannelView({
  channelId,
  channelName,
  serverId,
  memberUsers,
}: {
  channelId: string;
  channelName: string;
  serverId: string;
  memberUsers: Record<string, User>;
}) {
  const connectionState = useVoiceStore((s) => s.connectionState);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const participants = useVoiceStore((s) => s.participants);
  const error = useVoiceStore((s) => s.error);
  const joinChannel = useVoiceStore((s) => s.joinChannel);
  const leaveChannel = useVoiceStore((s) => s.leaveChannel);

  const isInThisChannel = voiceChannelId === channelId;
  const isConnected = isInThisChannel && connectionState === 'connected';
  const isConnecting = isInThisChannel && connectionState === 'connecting';

  const handleJoin = () => {
    joinChannel(channelId, serverId, channelName).catch((e) => {
      console.warn('Failed to join voice channel:', e);
    });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6">
      {/* Voice icon */}
      <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center">
        <Mic className="size-10 text-accent" strokeWidth={1.5} />
      </div>

      <div className="text-center">
        <h2 className="text-text-primary text-xl font-semibold mb-1">{channelName}</h2>
        <p className="text-text-tertiary text-sm">
          {isConnected
            ? `Connected — ${participants.length} participant${participants.length !== 1 ? 's' : ''}`
            : isConnecting
              ? 'Connecting...'
              : 'Voice Channel'}
        </p>
      </div>

      {error && (
        <div className="bg-danger/10 text-danger text-sm px-4 py-2 rounded max-w-sm text-center">
          {error}
        </div>
      )}

      {/* Participants grid */}
      {isInThisChannel && participants.length > 0 && (
        <div className="flex flex-wrap gap-4 justify-center max-w-lg">
          {participants.map((p) => {
            const user = memberUsers[p.userId];
            return (
              <div key={p.userId} className="flex flex-col items-center gap-1.5">
                <div className={`relative rounded-full ${p.isSpeaking ? 'ring-2 ring-green-400' : ''}`}>
                  <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={56} userId={p.userId} />
                  {p.isMuted && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-danger rounded-full flex items-center justify-center">
                      <VolumeX className="size-3 text-white" strokeWidth={2.5} />
                    </div>
                  )}
                </div>
                <span className="text-text-secondary text-xs truncate max-w-20">
                  {user?.username ?? 'User'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Join / Leave button */}
      {!isInThisChannel ? (
        <button
          onClick={handleJoin}
          className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-full font-medium text-sm transition-colors"
        >
          Join Voice
        </button>
      ) : isConnecting ? (
        <button
          onClick={() => leaveChannel()}
          className="px-6 py-2.5 bg-surface hover:bg-hover text-text-secondary rounded-full font-medium text-sm transition-colors"
        >
          Cancel
        </button>
      ) : (
        <button
          onClick={() => leaveChannel()}
          className="px-6 py-2.5 bg-danger hover:bg-danger/80 text-white rounded-full font-medium text-sm transition-colors"
        >
          Disconnect
        </button>
      )}
    </div>
  );
}
