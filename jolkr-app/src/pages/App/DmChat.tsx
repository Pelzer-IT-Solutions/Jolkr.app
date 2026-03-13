import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { usePresenceStore } from '../../stores/presence';
import { useUnreadStore } from '../../stores/unread';
import { wsClient } from '../../api/ws';
import * as api from '../../api/client';
import type { DmChannel, Message, User } from '../../api/types';
import MessageList from '../../components/MessageList';
import MessageInput from '../../components/MessageInput';
import Avatar from '../../components/Avatar';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog';
import { useMobileNav } from '../../hooks/useMobileNav';
import { isE2EEReady, getRecipientBundle } from '../../services/e2ee';
import { useCallStore } from '../../stores/call';
import { useVoiceStore } from '../../stores/voice';
import { useMessagesStore } from '../../stores/messages';
import { usePresignRefresh } from '../../hooks/usePresignRefresh';
import { Phone, Upload, ChevronLeft, Users, Lock, MoreVertical } from 'lucide-react';

function CallButton({ dmId, recipientName, recipientUserId, iconClassName }: { dmId: string; recipientName: string; recipientUserId?: string; iconClassName?: string }) {
  const startCall = useCallStore((s) => s.startCall);
  const activeCallDmId = useCallStore((s) => s.activeCallDmId);
  const outgoingCall = useCallStore((s) => s.outgoingCall);
  const incomingCall = useCallStore((s) => s.incomingCall);
  const voiceChannelId = useVoiceStore((s) => s.channelId);

  const inCall = !!activeCallDmId || !!outgoingCall || !!incomingCall || !!voiceChannelId;

  return (
    <button
      onClick={() => startCall(dmId, recipientName, recipientUserId)}
      disabled={inCall}
      className="p-1.5 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
      title={inCall ? 'Already in a call' : 'Start voice call'}
      aria-label="Start voice call"
    >
      <Phone className={iconClassName ?? "size-4.5"} />
    </button>
  );
}

export default function DmChat() {
  const { dmId } = useParams<{ dmId: string }>();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const statuses = usePresenceStore((s) => s.statuses);
  const setActiveChannel = useUnreadStore((s) => s.setActiveChannel);

  // Periodically refresh presigned S3 URLs (every 3h)
  usePresignRefresh(dmId, true);

  // DM cache ref — replaces former module-level mutable state
  const dmsCacheRef = useRef<DmChannel[] | null>(null);

  const getCachedDms = useCallback(async (): Promise<DmChannel[]> => {
    if (dmsCacheRef.current) return dmsCacheRef.current;
    const channels = await api.getDms();
    dmsCacheRef.current = channels;
    return channels;
  }, []);

  const invalidateDmsCache = useCallback(() => {
    dmsCacheRef.current = null;
  }, []);

  const [dmChannel, setDmChannel] = useState<DmChannel | null>(null);
  const [memberUsers, setMemberUsers] = useState<Record<string, User>>({});
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [e2eeAvailable, setE2eeAvailable] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [addMemberResults, setAddMemberResults] = useState<User[]>([]);
  const [addingMember, setAddingMember] = useState(false);
  const [actionError, setActionError] = useState('');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const dragCounterRef = useRef(0);
  const addMemberTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { setShowSidebar, isMobile } = useMobileNav();

  const isGroup = dmChannel?.is_group ?? false;

  // On mobile, when navigating to a DM, show content
  useEffect(() => {
    if (isMobile && dmId) setShowSidebar(false);
  }, [dmId, isMobile, setShowSidebar]);

  // Fetch DM channel info + member users (uses cached DMs list)
  const fetchChannelInfo = useCallback(() => {
    if (!dmId) return;
    getCachedDms().then((channels) => {
      const dm = channels.find((ch) => ch.id === dmId);
      if (dm) {
        setDmChannel(dm);
        dm.members.forEach((id) => {
          if (id !== currentUser?.id) {
            api.getUser(id).then((u) => {
              setMemberUsers((prev) => ({ ...prev, [u.id]: u }));
            }).catch(() => {});
          }
        });
      }
    }).catch(() => {});
  }, [dmId, currentUser?.id, getCachedDms]);

  useEffect(() => {
    fetchChannelInfo();
  }, [fetchChannelInfo]);

  // Listen for DmUpdate events to refresh channel info
  useEffect(() => {
    const unsub = wsClient.on((op, d) => {
      if (op === 'DmUpdate') {
        invalidateDmsCache();
        const ch = d?.channel as DmChannel | undefined;
        if (ch && ch.id === dmId) {
          setDmChannel(ch);
          ch.members.forEach((id: string) => {
            if (id !== currentUser?.id) {
              api.getUser(id).then((u) => {
                setMemberUsers((prev) => ({ ...prev, [u.id]: u }));
              }).catch(() => {});
            }
          });
        }
      }
    });
    return unsub;
  }, [dmId, currentUser?.id, invalidateDmsCache]);

  // Compute the "other user" for 1-on-1 DMs
  const otherUser = useMemo(() => {
    if (!dmChannel || isGroup) return null;
    const otherId = dmChannel.members.find((id) => id !== currentUser?.id);
    return otherId ? memberUsers[otherId] ?? null : null;
  }, [dmChannel, isGroup, currentUser?.id, memberUsers]);

  // Check E2EE availability (only for 1-on-1)
  useEffect(() => {
    if (isGroup) {
      setE2eeAvailable(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let retries = 0;
    const MAX_RETRIES = 5;
    const checkE2EE = () => {
      if (!otherUser || cancelled) return;
      if (!isE2EEReady()) {
        if (retries++ >= MAX_RETRIES) return;
        timer = setTimeout(checkE2EE, 2000);
        return;
      }
      getRecipientBundle(otherUser.id).then((bundle) => {
        if (!cancelled) setE2eeAvailable(bundle !== null);
      });
    };
    checkE2EE();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [otherUser, isGroup]);

  // Reset reply when DM channel changes + mark as read
  useEffect(() => {
    setReplyTo(null);
    setShowMembers(false);
    setAddMemberSearch('');
    setAddMemberResults([]);
    if (dmId) setActiveChannel(dmId);
    return () => {
      setActiveChannel(null);
      if (addMemberTimerRef.current) clearTimeout(addMemberTimerRef.current);
    };
  }, [dmId, setActiveChannel]);

  // Auto mark-as-read with throttle
  const lastMarkRef = useRef(0);
  // Select raw value from store (undefined is stable), then fallback outside selector
  // to avoid creating new [] references inside the selector (causes infinite re-renders)
  const messagesForChannel = useMessagesStore((s) => s.messages[dmId ?? '']);
  const lastMessage = messagesForChannel?.[messagesForChannel.length - 1];
  const lastMsgId = lastMessage?.id;
  const lastMsgAuthor = lastMessage?.author_id;
  useEffect(() => {
    if (!dmId || !lastMsgId || lastMsgAuthor === currentUser?.id) return;
    const now = Date.now();
    if (now - lastMarkRef.current < 3000) return;
    lastMarkRef.current = now;
    api.markDmRead(dmId, lastMsgId).catch(() => {});
  }, [dmId, lastMsgId, lastMsgAuthor, currentUser?.id]);

  // Clear add member state when sidebar is hidden
  useEffect(() => {
    if (!showMembers) {
      setAddMemberSearch('');
      setAddMemberResults([]);
    }
  }, [showMembers]);

  // Add member search handler (debounced)
  const handleAddMemberSearch = useCallback((value: string) => {
    setAddMemberSearch(value);
    if (addMemberTimerRef.current) clearTimeout(addMemberTimerRef.current);
    if (value.trim().length < 2) {
      setAddMemberResults([]);
      return;
    }
    addMemberTimerRef.current = setTimeout(() => {
      api.searchUsers(value.trim())
        .then((results) => setAddMemberResults(
          results.filter((u) =>
            u.id !== currentUser?.id &&
            !dmChannel?.members.includes(u.id),
          ),
        ))
        .catch(() => setAddMemberResults([]));
    }, 300);
  }, [currentUser?.id, dmChannel?.members]);

  const handleAddMember = async (userId: string) => {
    if (!dmId || addingMember) return;
    setAddingMember(true);
    setActionError('');
    try {
      await api.addDmMember(dmId, userId);
      setAddMemberSearch('');
      setAddMemberResults([]);
    } catch (e) {
      console.warn('Failed to add member:', e);
      setActionError((e as Error).message || 'Failed to add member');
    }
    setAddingMember(false);
  };

  const handleLeave = async () => {
    if (!dmId) return;
    setActionError('');
    try {
      await api.leaveDm(dmId);
      navigate('/friends');
    } catch (e) {
      console.warn('Failed to leave group DM:', e);
      setActionError((e as Error).message || 'Failed to leave group');
    }
  };

  // These hooks must be called unconditionally (Rules of Hooks)
  const mentionableUsers = useMemo(() => {
    if (isGroup && dmChannel) {
      const list: { id: string; username: string }[] = [];
      dmChannel.members.forEach((id) => {
        if (id === currentUser?.id && currentUser) {
          list.push({ id: currentUser.id, username: currentUser.username });
        } else {
          const u = memberUsers[id];
          if (u) list.push({ id: u.id, username: u.username });
        }
      });
      return list;
    }
    const list = [];
    if (otherUser) list.push({ id: otherUser.id, username: otherUser.username });
    if (currentUser) list.push({ id: currentUser.id, username: currentUser.username });
    return list;
  }, [otherUser, currentUser, isGroup, dmChannel, memberUsers]);

  const groupDisplayName = useMemo(() => {
    if (!isGroup || !dmChannel) return '';
    if (dmChannel.name) return dmChannel.name;
    const names = dmChannel.members
      .filter((id) => id !== currentUser?.id)
      .map((id) => memberUsers[id]?.username)
      .filter(Boolean);
    return names.join(', ') || 'Group DM';
  }, [isGroup, dmChannel, currentUser?.id, memberUsers]);

  // Drag-and-drop handlers for the full DM chat area
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

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
    const dropped = Array.from(e.dataTransfer.files);
    const valid = dropped.filter((f) => f.size <= 25 * 1024 * 1024);
    if (valid.length > 0) {
      setDroppedFiles(valid);
    }
  }, []);

  if (!dmId) return null;

  const partnerStatus = otherUser ? (statuses[otherUser.id] ?? 'offline') : undefined;

  // Determine reply author for the reply bar
  const replyAuthor = replyTo
    ? (replyTo.author_id === currentUser?.id
        ? currentUser as User
        : memberUsers[replyTo.author_id] ?? otherUser)
    : null;

  return (
    <>
      <div
        className="flex-1 flex flex-col bg-bg-tertiary min-w-0 min-h-0 page-transition relative"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
          {/* Full-window drop overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-10 h-10 text-primary" />
                <span className="text-primary font-semibold text-lg">Drop files to upload</span>
              </div>
            </div>
          )}
          {/* Header */}
          <div className={`flex items-center shrink-0 ${
            isMobile
              ? 'bg-bg-tertiary px-4 py-2 gap-3 border-b border-border-subtle'
              : 'bg-bg-tertiary px-5 py-3 gap-3 border-b border-border-subtle'
          }`}>
            {isMobile && (
              <button onClick={() => setShowSidebar(true)} className="text-text-secondary hover:text-text-primary" aria-label="Back to conversations">
                <ChevronLeft className="size-5.5" />
              </button>
            )}

            {isGroup ? (
              /* Group DM header */
              <>
                <div className="size-8 rounded-full bg-primary/30 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-base font-semibold text-text-primary truncate block">{groupDisplayName}</span>
                  <span className="text-xs text-text-muted">{dmChannel?.members.length} members</span>
                </div>
                <button
                  onClick={() => setShowMembers(!showMembers)}
                  className={`p-1.5 rounded hover:bg-bg-hover ${showMembers ? 'text-text-primary' : 'text-text-secondary'}`}
                  title="Toggle members"
                  aria-label="Toggle members"
                >
                  <Users className="size-4.5" />
                </button>
              </>
            ) : (
              /* 1-on-1 DM header */
              <>
                {otherUser && <Avatar url={otherUser.avatar_url} name={otherUser.username} size={32} status={partnerStatus} userId={otherUser.id} />}
                <span className="text-base font-semibold text-text-primary">{otherUser?.username ?? 'Direct Message'}</span>
                {e2eeAvailable && (
                  <span title="End-to-end encrypted"><Lock className="w-4 h-4 text-green-400" /></span>
                )}
                <div className="flex-1" />
                {isMobile ? (
                  <div className="flex items-center gap-3">
                    <CallButton dmId={dmId!} recipientName={otherUser?.username ?? 'User'} recipientUserId={otherUser?.id} iconClassName="size-5 text-text-secondary" />
                    <button className="text-text-secondary hover:text-text-primary" aria-label="More options">
                      <MoreVertical className="size-5" />
                    </button>
                  </div>
                ) : (
                  <div className="gap-4 flex ml-auto">
                    <CallButton dmId={dmId!} recipientName={otherUser?.username ?? 'User'} recipientUserId={otherUser?.id} />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Main content area */}
          <div className="flex-1 flex min-h-0">
            {/* Messages */}
            <div className={`flex-1 flex flex-col min-w-0 ${isMobile ? 'justify-end' : ''}`}>
              <div className={isMobile ? 'py-3 gap-1 flex flex-col flex-1 min-h-0' : 'flex-1 flex flex-col min-h-0'}>
                <MessageList channelId={dmId} isDm onReply={setReplyTo} />
              </div>
              <div>
                <MessageInput
                  channelId={dmId}
                  isDm
                  isGroupDm={isGroup}
                  dmMemberIds={isGroup ? dmChannel?.members : undefined}
                  recipientUserId={isGroup ? undefined : otherUser?.id}
                  replyTo={replyTo}
                  replyAuthor={replyAuthor}
                  onCancelReply={() => setReplyTo(null)}
                  mentionableUsers={mentionableUsers}
                  droppedFiles={droppedFiles}
                />
              </div>
            </div>

            {/* Members sidebar (group DM only) — overlay on mobile */}
            {isGroup && showMembers && (
              <div className={`${
                isMobile
                  ? 'fixed inset-y-0 right-0 w-[80vw] max-w-75 z-40 shadow-xl animate-slide-in-right'
                  : 'w-60 shrink-0 h-full overflow-hidden animate-fade-in'
              } bg-sidebar border border-divider flex flex-col`}>
                <div className="p-3 border-b border-divider">
                  <h3 className="text-text-primary text-sm font-semibold">
                    Members — {dmChannel?.members.length}
                  </h3>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                  {dmChannel?.members.map((memberId) => {
                    const user = memberId === currentUser?.id ? currentUser : memberUsers[memberId];
                    const status = statuses[memberId] ?? 'offline';
                    if (!user) return null;
                    return (
                      <div key={memberId} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-hover">
                        <Avatar url={user.avatar_url} name={user.username} size={28} status={status} userId={memberId} />
                        <span className="text-text-secondary text-sm truncate">
                          {user.username}
                          {memberId === currentUser?.id && <span className="text-text-muted text-xs ml-1">(you)</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Add member */}
                <div className="p-2 border-t border-divider">
                  <input
                    value={addMemberSearch}
                    onChange={(e) => handleAddMemberSearch(e.target.value)}
                    placeholder="Add a member..."
                    className="w-full bg-bg border border-divider rounded-lg px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted outline-none mb-1"
                  />
                  {addMemberResults.slice(0, 5).map((u) => (
                    <button
                      key={u.id}
                      onClick={() => handleAddMember(u.id)}
                      disabled={addingMember}
                      className="w-full px-2 py-1 rounded flex items-center gap-2 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                    >
                      <Avatar url={u.avatar_url} name={u.username} size={20} userId={u.id} />
                      <span className="truncate">{u.username}</span>
                    </button>
                  ))}
                  {actionError && <div className="text-xs text-error mt-1 px-1">{actionError}</div>}
                </div>

                {/* Leave group */}
                <div className="p-2 border-t border-divider">
                  <button
                    onClick={() => setShowLeaveConfirm(true)}
                    className="w-full px-3 py-1.5 text-sm text-error hover:bg-error/10 rounded text-left"
                  >
                    Leave Group
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      {showLeaveConfirm && (
        <ConfirmDialog
          title="Leave Group DM"
          message="Are you sure you want to leave this group? You won't be able to see new messages unless you're added back."
          confirmLabel="Leave"
          onConfirm={handleLeave}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </>
  );
}
