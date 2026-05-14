import { PanelLeftOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../api/client'
import s from '../../components/AppShell/AppShell.module.css'
import { CallWindow } from '../../components/CallWindow/CallWindow'
import { ChannelSettings } from '../../components/ChannelSettings/ChannelSettings'
import { ChannelSidebar } from '../../components/ChannelSidebar/ChannelSidebar'
import { ChatArea, type ChatAreaHandle } from '../../components/ChatArea/ChatArea'
import { CreateServerModal } from '../../components/CreateServerModal/CreateServerModal'
import { DMInfoPanel } from '../../components/DMInfoPanel/DMInfoPanel'
import { DMSidebar } from '../../components/DMSidebar/DMSidebar'
import { FriendsPanel } from '../../components/FriendsPanel'
import { GroupContextMenu, type GroupContextMenuState } from '../../components/GroupContextMenu'
import { GroupInfoPopover, type GroupInfoPopoverState } from '../../components/GroupInfoPopover'
import { GroupSettingsModal } from '../../components/GroupSettingsModal'
import { JoinServerModal } from '../../components/JoinServerModal/JoinServerModal'
import { MemberPanel } from '../../components/MemberPanel/MemberPanel'
import { NewDMModal } from '../../components/NewDMModal/NewDMModal'
import { NotificationsPanel } from '../../components/NotificationsPanel/NotificationsPanel'
import { ProfileCard } from '../../components/ProfileCard/ProfileCard'
import { ReportModal } from '../../components/ReportModal/ReportModal'
import { ServerSettings } from '../../components/ServerSettings/ServerSettings'
import { Settings } from '../../components/Settings/Settings'
import { TabBar } from '../../components/TabBar/TabBar'
import { PromptDialog } from '../../components/ui/PromptDialog/PromptDialog'
import { UserContextMenu } from '../../components/UserContextMenu'
import { VoiceConnectionBar } from '../../components/VoiceConnectionBar/VoiceConnectionBar'
import { useT } from '../../hooks/useT'
import { buildInviteUrl } from '../../platform/config'
import { invalidateFriendsCache } from '../../services/friendshipCache'
import { useLocaleStore } from '../../stores/locale'
import { useMessagesStore } from '../../stores/messages'
import { useNotificationSettingsStore } from '../../stores/notification-settings'
import { useServersStore, selectServerRoles, selectServerMembers } from '../../stores/servers'
import { useToast } from '../../stores/toast'
import { useUnreadStore } from '../../stores/unread'
import { buildDraftDm, isDraftDmId } from '../../utils/draftDm'
import { hasPermission, KICK_MEMBERS, BAN_MEMBERS, MANAGE_ROLES } from '../../utils/permissions'
import { orbsForHue } from '../../utils/theme'
import { useAppHandlers } from './useAppHandlers'
import { useAppInit } from './useAppInit'
import { useAppMemos } from './useAppMemos'
import type { MemberStatus } from '../../types'

export function AppShell() {
  const { t } = useT()
  const init = useAppInit()
  const memos = useAppMemos(init)
  const handlers = useAppHandlers(init, memos)

  // Pending message id for the "create thread" prompt — replaces window.prompt().
  const [threadPromptMsgId, setThreadPromptMsgId] = useState<string | null>(null)

  // Group-DM surfaces — each one is open on at most a single dm at a time.
  const [groupContextMenu, setGroupContextMenu] = useState<GroupContextMenuState | null>(null)
  const [groupInfoPopover, setGroupInfoPopover] = useState<GroupInfoPopoverState | null>(null)
  const [groupSettingsForDmId, setGroupSettingsForDmId] = useState<string | null>(null)

  // Mirror the active locale onto <html lang="..."> for screen readers,
  // Intl.Segmenter, browser hyphenation, and any CSS that targets `:lang(…)`.
  // Subscribe via a selector so we re-run only on locale switches, not on
  // every store mutation.
  const localeCode = useLocaleStore(s => s.code)
  useEffect(() => {
    document.documentElement.lang = localeCode
  }, [localeCode])

  // ── Destructure init ──
  const {
    user, servers, channelsByServer, presences, serverPermissions,
    dmActive, activeDmId, activeServerId, activeChannelId,
    tabbedIds, setTabbedIds, setActiveServerId, setActiveChannelId,
    setRightPanelMode,
    setUserOverrideLeft, setUserOverrideRight,
    activeMobilePane, setActiveMobilePane,
    setDmActive, setActiveDmId, dmList, setDmList,
    settingsOpen, setSettingsOpen,
    newDmOpen, setNewDmOpen,
    joinServerOpen, setJoinServerOpen,
    createServerOpen, setCreateServerOpen,
    searchActive, setSearchActive,
    notificationsActive, setNotificationsActive,
    friendsPanelOpen, setFriendsPanelOpen,
    serverSettingsOpen, setServerSettingsOpen,
    channelSettingsOpen, setChannelSettingsOpen,
    reportTarget, setReportTarget,
    userContextMenu, setUserContextMenu,
    contextMenuIsFriend,
    profileCard, setProfileCard,
    pinnedCount, pinnedVersion, threadsCount,
    openThreadId, setOpenThreadId,
    ready, serverThemes, setServerThemes,
    fetchServers,
  } = init

  // ── Destructure memos ──
  const {
    isDark, colorPref, setColorPref,
    userInfo, userProfile, userMap,
    uiServers, uiDmList,
    tabbedServers, activeServer, isServerOwner, myPerms,
    canAccessSettings, canManageChannels, canEditTheme,
    canManageMessages, canAddReactions, canSendMessages, canAttachFiles,
    inviteableServerIds, ownerServerIds, settingsServerIds,
    activeTheme, chatAnimKey, typingUsers, appStyle, activeDmConv,
    isDmWithSystemUser, activeChannel, displayMessages,
    mentionableUsers, activeChannelMembers,
    viewport, effectiveLeftCollapsed, effectiveRightCollapsed, effectiveRightMode,
  } = memos

  // ── Responsive layout helpers ──
  const isMobile = viewport.isMobile
  const showLeft  = !isMobile || activeMobilePane === 'left'
  const showChat  = !isMobile || activeMobilePane === 'chat'
  const showRight = !isMobile || activeMobilePane === 'right'
  // Whether the chat area has actual content to render (a DM with an active id,
  // or a server with an active channel). When false, the center slot shows the
  // welcome panel instead of ChatArea — sidebars still render normally so the
  // user can navigate (e.g. clicking DMs shows the DM list even with no DMs).
  const hasChatContent = (dmActive && !!activeDmId) || (!!activeServer && !!activeChannelId)

  const handleExpandSidebar = useCallback(() => {
    if (isMobile) setActiveMobilePane('left')
    else setUserOverrideLeft('open')
  }, [isMobile, setActiveMobilePane, setUserOverrideLeft])

  const handleCollapseSidebar = useCallback(() => {
    if (isMobile) setActiveMobilePane('chat')
    else setUserOverrideLeft('closed')
  }, [isMobile, setActiveMobilePane, setUserOverrideLeft])

  const handleSetRightPanelMode = useCallback((mode: 'members' | 'pinned' | 'threads' | null) => {
    if (isMobile) {
      if (mode === null) setActiveMobilePane('chat')
      else { setRightPanelMode(mode); setActiveMobilePane('right') }
    } else {
      if (mode === null) setUserOverrideRight('closed')
      else { setRightPanelMode(mode); setUserOverrideRight('open') }
    }
  }, [isMobile, setActiveMobilePane, setRightPanelMode, setUserOverrideRight])

  // Open a specific thread in the right panel — used by Message.tsx's
  // "{n} replies in thread" badge and by ThreadListPanel item clicks.
  const handleOpenThreadById = useCallback((threadId: string) => {
    setOpenThreadId(threadId)
    setRightPanelMode('threads')
    if (isMobile) setActiveMobilePane('right')
    else setUserOverrideRight('open')
  }, [setOpenThreadId, setRightPanelMode, isMobile, setActiveMobilePane, setUserOverrideRight])

  const mobileBackToChat = useCallback(() => setActiveMobilePane('chat'), [setActiveMobilePane])

  // Mobile: clicking a channel or DM should auto-close the side panel and
  // show the chat. Desktop keeps the multi-pane layout — no override needed.
  const handleSwitchChannelMobile = useCallback((id: string) => {
    handlers.handleSwitchChannel(id)
    if (isMobile) setActiveMobilePane('chat')
  }, [handlers, isMobile, setActiveMobilePane])

  const handleSelectDmMobile = useCallback((id: string) => {
    setActiveDmId(id)
    if (isMobile) setActiveMobilePane('chat')
  }, [setActiveDmId, isMobile, setActiveMobilePane])

  // ── ChatArea hot-path handlers ──
  // Stable references so ChatArea's child memoisation isn't defeated by a
  // fresh function identity on every AppShell render. The store reads inside
  // each callback are deliberate — they pick up the latest store snapshot at
  // call time without re-binding the callback on every store mutation.
  const effectiveChannelId = dmActive ? activeDmId : activeChannelId
  const chatHasMore = useMessagesStore(s => s.hasMore[effectiveChannelId] ?? true)
  const handleLoadOlder = useCallback(() => {
    const { fetchOlder, loadingOlder } = useMessagesStore.getState()
    if (!loadingOlder[effectiveChannelId]) fetchOlder(effectiveChannelId, dmActive)
  }, [effectiveChannelId, dmActive])
  const handleOpenAuthorProfile = useCallback((authorId: string, e: React.MouseEvent) => {
    setProfileCard({ userId: authorId, x: e.clientX, y: e.clientY })
  }, [setProfileCard])
  const handleStartThread = useCallback((messageId: string) => {
    if (dmActive || !activeChannelId) return
    setThreadPromptMsgId(messageId)
  }, [dmActive, activeChannelId])

  // ── Jump-to-message wiring ───────────────────────────────────────
  // The chat owns the imperative scroll; pinned + shared-files panels just
  // call into this ref. On mobile the right pane is shown alone, so we hop
  // back to the chat pane first and defer the scroll until that swap commits.
  const chatAreaRef = useRef<ChatAreaHandle>(null)
  const handleJumpToMessage = useCallback((messageId: string) => {
    if (isMobile) {
      setActiveMobilePane('chat')
      requestAnimationFrame(() => {
        void chatAreaRef.current?.scrollToMessage(messageId)
      })
      return
    }
    void chatAreaRef.current?.scrollToMessage(messageId)
  }, [isMobile, setActiveMobilePane])

  // Open a 1-on-1 conversation with `otherUserId`: reuse an existing real DM
  // if we already have one, otherwise drop a session-only draft into the
  // sidebar. Used by FriendsPanel and ProfileCard so the recipient never
  // sees a phantom DM before a message has actually been sent.
  const openDmDraft = useCallback((otherUserId: string) => {
    if (!user) return
    const existing = dmList.find(d =>
      !d.is_group
      && !isDraftDmId(d.id)
      && d.members.length === 2
      && d.members.includes(otherUserId),
    )
    if (existing) {
      setActiveDmId(existing.id)
    } else {
      const draft = buildDraftDm([user.id, otherUserId])
      setDmList(prev => (prev.some(d => d.id === draft.id) ? prev : [draft, ...prev]))
      setActiveDmId(draft.id)
    }
    setDmActive(true)
    if (isMobile) setActiveMobilePane('chat')
  }, [user, dmList, setDmList, setActiveDmId, setDmActive, isMobile, setActiveMobilePane])

  const sidebarCollapsedForChannelSidebar = isMobile ? false : effectiveLeftCollapsed
  const sidebarCollapsedForChatHeader     = isMobile ? true  : effectiveLeftCollapsed
  const rightPanelHidden                   = isMobile ? false : effectiveRightCollapsed

  // ── Destructure handlers ──
  const {
    mutedServerIds, handleToggleMuteServer,
    handleToggleMuteDm, handleLeaveGroupDm,
    handleLogout, handleStatusChange, handleUpdateProfile,
    handleUploadAvatar, handleTyping,
    handleSwitchServer, handleCloseTab, handleOpenServer,
    handleSend, handleToggleReaction, handleDeleteMessage, handleHideDmMessage, handleEditMessage,
    handlePinMessage, handleUnpinMessage, handleThemeChange,
    handleCreateChannel, handleCreateCategory, handleDeleteChannel,
    handleDeleteCategory, handleRenameChannel, handleRenameCategory, handleArchiveChannel,
    handleReorderChannels, handleReorderCategories,
    handleJoinServer, handleCreateServer, handleCreateDm,
  } = handlers

  // ── Role assignment for context menu ──
  // Use stable sentinel selectors so empty arrays share identity across renders
  // (prevents infinite-render loops via Zustand selector returning new array per render)
  const serverRoles = useServersStore(selectServerRoles(activeServerId))
  const serverMembers = useServersStore(selectServerMembers(activeServerId))
  const fetchRoles = useServersStore(s => s.fetchRoles)
  const canManageRoles = !dmActive && (isServerOwner || hasPermission(myPerms, MANAGE_ROLES))

  // Fetch roles when context menu opens on a server (lazy load)
  useEffect(() => {
    if (userContextMenu && canManageRoles && activeServerId && serverRoles.length === 0) {
      fetchRoles(activeServerId).catch(console.warn)
    }
  }, [userContextMenu, canManageRoles, activeServerId, serverRoles.length, fetchRoles])

  const contextMenuUserRoleIds = userContextMenu
    ? serverMembers.find(m => m.user_id === userContextMenu.user.user_id)?.role_ids ?? []
    : []

  // Pre-built "invite to server" list for UserContextMenu — keeps the prop
  // identity stable so the (potentially memoized) menu doesn't re-render on
  // every parent tick. Set lookup avoids the O(n×m) of array.includes inside
  // the filter.
  const inviteableServerIdSet = useMemo(() => new Set(inviteableServerIds), [inviteableServerIds])
  const inviteableServersWithHue = useMemo(
    () => servers
      .filter(srv => inviteableServerIdSet.has(srv.id))
      .map(srv => ({ ...srv, hue: serverThemes[srv.id]?.hue ?? null })),
    [servers, inviteableServerIdSet, serverThemes],
  )

  const handleToggleRole = useCallback(async (userId: string, roleId: string, hasRole: boolean) => {
    if (!activeServerId) return
    try {
      const store = useServersStore.getState()
      if (hasRole) await store.removeRole(activeServerId, roleId, userId)
      else await store.assignRole(activeServerId, roleId, userId)
    } catch (err) {
      console.error('Role toggle failed:', err)
    }
  }, [activeServerId])

  // ── Group-DM surface lookups ──
  // Resolve the active DM record for each surface so the child components
  // stay pure (they don't reach into the DM list themselves).
  const groupContextMenuConv = useMemo(
    () => groupContextMenu ? uiDmList.find(d => d.id === groupContextMenu.dmId) ?? null : null,
    [groupContextMenu, uiDmList],
  )
  const groupInfoConv = useMemo(
    () => groupInfoPopover ? uiDmList.find(d => d.id === groupInfoPopover.dmId) ?? null : null,
    [groupInfoPopover, uiDmList],
  )
  const groupSettingsConv = useMemo(
    () => groupSettingsForDmId ? uiDmList.find(d => d.id === groupSettingsForDmId) ?? null : null,
    [groupSettingsForDmId, uiDmList],
  )
  const isGroupContextMenuMuted = useNotificationSettingsStore(st =>
    !!groupContextMenu && st.settings.some(x =>
      x.target_type === 'channel' && x.target_id === groupContextMenu.dmId && x.muted,
    ),
  )

  // ── Render ──

  if (!ready) {
    return (
      <div className={s.app} style={appStyle}>
        <div className={s.splash}>
          <img src="/icon.svg" alt="Jolkr" className={s.splashLogo} />
          <div className={s.splashSpinner} />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={s.app} style={appStyle}>
        <TabBar
          allServers={uiServers}
          tabbedServers={tabbedServers}
          activeServerId={dmActive ? '' : activeServerId}
          dmActive={dmActive}
          searchActive={searchActive}
          notificationsActive={notificationsActive}
          user={userInfo}
          userProfile={userProfile}
          mutedServerIds={mutedServerIds}
          currentStatus={(user?.id ? presences[user.id] : undefined) as MemberStatus | undefined}
          ownerServerIds={ownerServerIds}
          onSwitch={id => { setDmActive(false); handleSwitchServer(id) }}
          onClose={handleCloseTab}
          onReorder={ids => { setTabbedIds(ids); useServersStore.getState().reorderServers(ids) }}
          onOpenServer={id => { setDmActive(false); handleOpenServer(id) }}
          onDmClick={() => {
            setDmActive(v => {
              if (!v) {
                // Switching TO DM mode: select last active DM or first available
                if (!activeDmId && dmList.length > 0) {
                  setActiveDmId(dmList[0].id)
                }
              }
              return !v
            })
          }}
          onSearchClick={() => setSearchActive(v => !v)}
          onNotificationsClick={() => setNotificationsActive(v => !v)}
          onOpenSettings={() => setSettingsOpen(true)}
          onJoinServer={() => setJoinServerOpen(true)}
          onCreateServer={() => setCreateServerOpen(true)}
          onLogout={handleLogout}
          onStatusChange={handleStatusChange}
          onToggleMuteServer={handleToggleMuteServer}
          onMarkAllRead={async (serverId) => {
            try {
              await api.markServerRead(serverId)
              const chs = channelsByServer[serverId] ?? []
              useUnreadStore.getState().markServerRead(chs.map(c => c.id))
            } catch (err) {
              console.error('Mark server read failed:', err)
            }
          }}
          settingsServerIds={settingsServerIds}
          onOpenServerSettings={serverId => { handleSwitchServer(serverId); setServerSettingsOpen(true) }}
          onLeaveServer={async (serverId) => {
            try {
              await api.leaveServer(serverId)
              await fetchServers()
            } catch (err) {
              const msg = err instanceof Error ? err.message : t('toast.leaveServerFailed')
              useToast.getState().show(msg, 'error')
              console.error('Leave server failed:', err)
            }
          }}
        />

        <div className={s.contentRow}>
          <div className={s.shell}>
            <div className={s.workspace}>
              {showLeft && (dmActive ? (
                    <DMSidebar
                      conversations={uiDmList}
                      activeId={activeDmId}
                      onSelect={handleSelectDmMobile}
                      onNewMessage={() => setNewDmOpen(true)}
                      onOpenFriends={() => setFriendsPanelOpen(true)}
                      onConversationContextMenu={(conv, e) => {
                        // Group DMs open the GroupContextMenu surface; 1:1 DMs
                        // fall through to the user-context menu so the existing
                        // friend / block / close-dm actions stay available.
                        if (conv.type === 'group') {
                          setGroupContextMenu({ x: e.clientX, y: e.clientY, dmId: conv.id })
                          return
                        }
                        const p = conv.participants[0]
                        if (!p?.userId) return
                        setUserContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          user: {
                            user_id: p.userId,
                            username: p.name,
                            display_name: p.name,
                            status: p.status,
                            color: p.color,
                            letter: p.letter,
                            avatar_url: p.avatarUrl,
                          },
                          // Carry the DM id so the "Close DM" handler knows what to close.
                          dmId: conv.id,
                        })
                      }}
                      collapsed={sidebarCollapsedForChannelSidebar}
                      onCollapse={handleCollapseSidebar}
                      isMobile={isMobile}
                    />
                  ) : activeServer ? (
                    <ChannelSidebar
                      server={activeServer}
                      activeChannelId={activeChannelId}
                      onSwitch={handleSwitchChannelMobile}
                      onCollapse={handleCollapseSidebar}
                      collapsed={sidebarCollapsedForChannelSidebar}
                      isMobile={isMobile}
                      theme={activeTheme}
                      onThemeChange={handleThemeChange}
                      isDark={isDark}
                      colorPref={colorPref}
                      onSetColorPref={setColorPref}
                      onOpenSettings={canAccessSettings ? () => setServerSettingsOpen(true) : undefined}
                      canManageChannels={canManageChannels}
                      canEditTheme={canEditTheme}
                      onCreateChannel={canManageChannels ? handleCreateChannel : undefined}
                      onCreateCategory={canManageChannels ? handleCreateCategory : undefined}
                      onDeleteChannel={canManageChannels ? handleDeleteChannel : undefined}
                      onDeleteCategory={canManageChannels ? handleDeleteCategory : undefined}
                      onRenameChannel={canManageChannels ? handleRenameChannel : undefined}
                      onRenameCategory={canManageChannels ? handleRenameCategory : undefined}
                      onArchiveChannel={canManageChannels ? handleArchiveChannel : undefined}
                      onOpenChannelSettings={canManageChannels ? (channelId) => { setActiveChannelId(channelId); setChannelSettingsOpen(true) } : undefined}
                      onReorderChannels={canManageChannels ? handleReorderChannels : undefined}
                      onReorderCategories={canManageChannels ? handleReorderCategories : undefined}
                    />
                  ) : null)}

                  {showChat && (hasChatContent ? (
                    <ChatArea
                      ref={chatAreaRef}
                      channel={activeChannel}
                      messages={displayMessages}
                      sidebarCollapsed={sidebarCollapsedForChatHeader}
                      rightPanelMode={effectiveRightMode}
                      onExpandSidebar={handleExpandSidebar}
                      onSetRightPanelMode={handleSetRightPanelMode}
                      onSend={handleSend}
                      onToggleReaction={handleToggleReaction}
                      onDeleteMessage={handleDeleteMessage}
                      onHideMessage={handleHideDmMessage}
                      onEditMessage={handleEditMessage}
                      isDm={dmActive}
                      dmConversation={dmActive ? activeDmConv : undefined}
                      animationKey={chatAnimKey}
                      onTyping={handleTyping}
                      typingUsers={typingUsers}
                      hasPinnedMessages={pinnedCount > 0}
                      hasThreads={threadsCount > 0}
                      serverId={dmActive ? undefined : activeServerId}
                      userMap={userMap}
                      onLoadOlder={handleLoadOlder}
                      hasMore={chatHasMore}
                      readOnly={isDmWithSystemUser}
                      onPinMessage={handlePinMessage}
                      onOpenAuthorProfile={handleOpenAuthorProfile}
                      mentionableUsers={mentionableUsers}
                      canManageMessages={canManageMessages}
                      canAddReactions={canAddReactions}
                      canSendMessages={canSendMessages}
                      canAttachFiles={canAttachFiles}
                      onOpenThread={handleOpenThreadById}
                      onStartThread={handleStartThread}
                    />
                  ) : (
                    <div className={s.emptyState}>
                      {effectiveLeftCollapsed && (
                        <button
                          type="button"
                          className={s.emptyExpandBtn}
                          title={t('common.expandSidebar')}
                          onClick={handleExpandSidebar}
                        >
                          <PanelLeftOpen size={14} strokeWidth={1.5} />
                        </button>
                      )}
                      <div style={{ fontSize: '3rem' }}>👋</div>
                      <h2 className="txt-body txt-semibold">{t('appShell.welcomeTitle')}</h2>
                      <p className="txt-small">{t('appShell.welcomeBody')}</p>
                    </div>
                  ))}

                  {showRight && hasChatContent && (dmActive ? (
                    <DMInfoPanel
                      open={!rightPanelHidden}
                      dmId={activeDmId}
                      onUnpin={handleUnpinMessage}
                      onJumpToMessage={handleJumpToMessage}
                      users={userMap}
                      pinnedVersion={pinnedVersion}
                      onMobileClose={isMobile ? mobileBackToChat : undefined}
                    />
                  ) : activeServer ? (
                    <MemberPanel
                      members={activeChannelMembers ?? activeServer.members}
                      mode={effectiveRightMode}
                      serverId={activeServerId}
                      channelId={activeChannelId}
                      isDm={false}
                      onMemberClick={(member, e) => {
                        if (!member.userId) return
                        const u = userMap.get(member.userId)
                        setUserContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          user: {
                            user_id: member.userId,
                            username: u?.username ?? member.name,
                            display_name: u?.display_name ?? member.name,
                            status: member.status,
                            color: member.color,
                            letter: member.letter,
                            avatar_url: member.avatarUrl,
                          },
                        })
                      }}
                      onMemberOpenProfile={(member, e) => {
                        if (!member.userId) return
                        setProfileCard({ userId: member.userId, x: e.clientX, y: e.clientY })
                      }}
                      onUnpin={handleUnpinMessage}
                      onJumpToMessage={handleJumpToMessage}
                      users={userMap}
                      pinnedVersion={pinnedVersion}
                      onMobileClose={isMobile ? mobileBackToChat : undefined}
                      openThreadId={openThreadId}
                      onOpenThread={(t) => setOpenThreadId(t.id)}
                      onCloseThread={() => setOpenThreadId(null)}
                    />
                  ) : null)}
            </div>
          </div>

          <NotificationsPanel
            open={notificationsActive}
            onNavigate={(serverId, channelId) => {
              setDmActive(false)
              if (!tabbedIds.includes(serverId)) {
                setTabbedIds(prev => [serverId, ...prev])
              }
              setActiveServerId(serverId)
              setActiveChannelId(channelId)
              setNotificationsActive(false)
            }}
          />
        </div>
      </div>

      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          isDark={isDark}
          colorPref={colorPref}
          onSetColorPref={setColorPref}
          user={userInfo}
          onLogout={handleLogout}
          onUpdateProfile={handleUpdateProfile}
          onUploadAvatar={handleUploadAvatar}
        />
      )}

      {newDmOpen && (
        <NewDMModal
          onClose={() => setNewDmOpen(false)}
          onCreate={handleCreateDm}
          existingDms={uiDmList}
        />
      )}

      {joinServerOpen && (
        <JoinServerModal
          onClose={() => setJoinServerOpen(false)}
          onJoin={handleJoinServer}
        />
      )}

      {createServerOpen && (
        <CreateServerModal
          onClose={() => setCreateServerOpen(false)}
          onCreate={handleCreateServer}
        />
      )}

      <FriendsPanel
        open={friendsPanelOpen}
        onClose={() => setFriendsPanelOpen(false)}
        onStartDM={(otherUserId) => {
          openDmDraft(otherUserId)
          setFriendsPanelOpen(false)
        }}
        onAcceptRequest={async (id) => { await api.acceptFriend(id) }}
        onRejectRequest={async (id) => { await api.declineFriend(id) }}
        onRemoveFriend={async (userId) => { await api.removeFriendByUserId(userId) }}
      />

      {serverSettingsOpen && activeServer && (() => {
        const rawServer = servers.find(s => s.id === activeServerId)
        if (!rawServer) return null
        return (
        <ServerSettings
          server={{
            ...rawServer,
            hue: serverThemes[activeServerId]?.hue ?? null,
            discoverable: rawServer.is_public ?? false,
          }}
          onClose={() => setServerSettingsOpen(false)}
          onUpdate={async (serverId, data) => {
            // Map editable Overview fields → backend updateServer body.
            // Anything not provided in `data` is left unchanged on the server.
            const body: Parameters<typeof api.updateServer>[1] = {}
            if (data.name !== undefined) body.name = data.name
            if (data.description !== undefined) body.description = data.description ?? undefined
            if (data.icon_url !== undefined) body.icon_url = data.icon_url ?? undefined
            if (data.discoverable !== undefined) body.is_public = data.discoverable
            // `hue` (and any banner_url) are wrapped into the theme blob the backend stores.
            if (data.hue !== undefined || data.banner_url !== undefined) {
              const nextHue = data.hue ?? serverThemes[serverId]?.hue ?? null
              const orbs = nextHue != null ? orbsForHue(nextHue) : []
              body.theme = { hue: nextHue, orbs }
              // Persist the new local theme so subsequent renders reflect the save
              setServerThemes(prev => ({ ...prev, [serverId]: { hue: nextHue, orbs } }))
            }
            await api.updateServer(serverId, body)
            fetchServers()
          }}
          onDelete={async (serverId) => {
            try {
              await api.deleteServer(serverId)
              setServerSettingsOpen(false)
              await fetchServers() // safety effect handles fallback
            } catch (err) {
              const msg = err instanceof Error ? err.message : t('toast.deleteServerFailed')
              useToast.getState().show(msg, 'error')
              throw err
            }
          }}
          onLeave={async (serverId) => {
            try {
              await api.leaveServer(serverId)
              setServerSettingsOpen(false)
              await fetchServers() // safety effect handles fallback
            } catch (err) {
              const msg = err instanceof Error ? err.message : t('toast.leaveServerFailed')
              useToast.getState().show(msg, 'error')
              throw err
            }
          }}
        />
        )
      })()}

      {channelSettingsOpen && activeChannel && activeServerId && (() => {
        const rawChannels = channelsByServer[activeServerId] ?? []
        const rawChannel = rawChannels.find(ch => ch.id === activeChannelId)
        if (!rawChannel) return null
        return (
          <ChannelSettings
            channel={rawChannel}
            serverId={activeServerId}
            serverPermissions={serverPermissions[activeServerId] ?? 0}
            onClose={() => setChannelSettingsOpen(false)}
            onUpdate={async (channelId, data) => {
              await api.updateChannel(channelId, data)
              await init.fetchChannels(activeServerId)
            }}
          />
        )
      })()}

      <ReportModal
        open={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        user={reportTarget}
      />

      <VoiceConnectionBar />
      <CallWindow />

      <UserContextMenu
        menu={userContextMenu}
        onClose={() => setUserContextMenu(null)}
        onViewProfile={(userId, anchor) => {
          setProfileCard({ userId, x: anchor.x, y: anchor.y })
        }}
        onCloseDm={userContextMenu?.dmId ? async () => {
          const dmId = userContextMenu.dmId!
          // Drafts are session-only, so closing just drops the local entry —
          // the server never knew about them in the first place.
          if (isDraftDmId(dmId)) {
            setDmList(prev => prev.filter(d => d.id !== dmId))
            if (activeDmId === dmId) setActiveDmId('')
            return
          }
          try {
            await api.closeDm(dmId)
            setDmList(prev => prev.filter(d => d.id !== dmId))
            if (activeDmId === dmId) {
              setActiveDmId('')
            }
          } catch (e) {
            console.warn('Failed to close DM:', e)
          }
        } : undefined}
        onReport={() => {
          if (userContextMenu) setReportTarget(userContextMenu.user)
          setUserContextMenu(null)
        }}
        onAddFriend={async (userId: string) => {
          try {
            await api.sendFriendRequest(userId)
            invalidateFriendsCache()
          } catch (e) {
            useToast.getState().show((e as Error).message || t('toast.friendRequestFailed'), 'error')
          }
          setUserContextMenu(null)
        }}
        onRemoveFriend={async (userId: string) => {
          await api.removeFriendByUserId(userId).catch(console.warn)
          invalidateFriendsCache()
          setUserContextMenu(null)
        }}
        onBlock={async (userId: string) => {
          await api.blockUser(userId).catch(console.warn)
          invalidateFriendsCache()
          setUserContextMenu(null)
        }}
        onInviteToServer={async (_userId: string, serverId: string) => {
          const invite = await api.createInvite(serverId, { max_uses: 1 }).catch(() => null)
          if (invite) {
            const url = buildInviteUrl(invite.code)
            try {
              await navigator.clipboard.writeText(url)
              useToast.getState().show(t('toast.inviteCopied'), 'success')
            } catch {
              useToast.getState().show(t('toast.inviteCopyFailed', { url }), 'error', 6000)
            }
          } else {
            useToast.getState().show(t('toast.inviteCreateFailed'), 'error')
          }
          setUserContextMenu(null)
        }}
        canKick={!dmActive && (isServerOwner || hasPermission(myPerms, KICK_MEMBERS))}
        canBan={!dmActive && (isServerOwner || hasPermission(myPerms, BAN_MEMBERS))}
        onKick={async (userId: string) => {
          if (activeServerId) await api.kickMember(activeServerId, userId).catch(console.warn)
          setUserContextMenu(null)
        }}
        onBan={async (userId: string) => {
          if (activeServerId) await api.banMember(activeServerId, userId).catch(console.warn)
          setUserContextMenu(null)
        }}
        servers={inviteableServersWithHue}
        roles={serverRoles}
        userRoleIds={contextMenuUserRoleIds}
        canManageRoles={canManageRoles}
        isFriend={contextMenuIsFriend}
        onToggleRole={handleToggleRole}
      />

      {profileCard && (
        <ProfileCard
          state={profileCard}
          onClose={() => setProfileCard(null)}
          onStartDm={openDmDraft}
        />
      )}

      <GroupContextMenu
        menu={groupContextMenu}
        conv={groupContextMenuConv}
        isMuted={isGroupContextMenuMuted}
        onClose={() => setGroupContextMenu(null)}
        onViewInfo={(dmId, anchor) => {
          setGroupInfoPopover({ x: anchor.x, y: anchor.y, dmId })
        }}
        onToggleMute={handleToggleMuteDm}
        onEdit={(dmId) => setGroupSettingsForDmId(dmId)}
        onLeave={handleLeaveGroupDm}
      />

      <GroupInfoPopover
        state={groupInfoPopover}
        conv={groupInfoConv}
        onClose={() => setGroupInfoPopover(null)}
        onOpenMemberProfile={(userId, anchor) => {
          setGroupInfoPopover(null)
          setProfileCard({ userId, x: anchor.x, y: anchor.y })
        }}
      />

      <GroupSettingsModal
        open={groupSettingsForDmId !== null}
        conv={groupSettingsConv}
        onClose={() => setGroupSettingsForDmId(null)}
      />

      <PromptDialog
        open={threadPromptMsgId !== null}
        title={t('chat.threadPrompt.title')}
        placeholder={t('chat.threadPrompt.namePlaceholder')}
        submitLabel={t('chat.threadPrompt.createBtn')}
        cancelLabel={t('common.cancel')}
        allowEmpty
        onSubmit={async (name) => {
          const messageId = threadPromptMsgId
          setThreadPromptMsgId(null)
          if (!messageId || !activeChannelId) return
          try {
            await api.createThread(activeChannelId, messageId, name || undefined)
            // Backend emits ThreadCreate → store bumps threadListVersion →
            // ThreadListPanel + threadsCount refresh.
          } catch (err) {
            const msg = err instanceof Error ? err.message : t('toast.createThreadFailed')
            useToast.getState().show(msg, 'error')
          }
        }}
        onCancel={() => setThreadPromptMsgId(null)}
      />
    </>
  )
}
