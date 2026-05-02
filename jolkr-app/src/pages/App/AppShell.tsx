import { useCallback, useEffect } from 'react'
import { hasPermission, KICK_MEMBERS, BAN_MEMBERS, MANAGE_ROLES } from '../../utils/permissions'
import type { MemberStatus } from '../../types'
import { useUnreadStore } from '../../stores/unread'
import { useMessagesStore } from '../../stores/messages'
import { useServersStore, selectServerRoles, selectServerMembers } from '../../stores/servers'
import { useToast } from '../../components/Toast'
import { buildInviteUrl } from '../../platform/config'
import { orbsForHue } from '../../utils/theme'
import * as api from '../../api/client'

import { TabBar } from '../../components/TabBar/TabBar'
import { ChannelSidebar } from '../../components/ChannelSidebar/ChannelSidebar'
import { VoiceConnectionBar } from '../../components/VoiceConnectionBar/VoiceConnectionBar'
import { CallWindow } from '../../components/CallWindow/CallWindow'
import { DMSidebar } from '../../components/DMSidebar/DMSidebar'
import { ChatArea } from '../../components/ChatArea/ChatArea'
import { MemberPanel } from '../../components/MemberPanel/MemberPanel'
import { DMInfoPanel } from '../../components/DMInfoPanel/DMInfoPanel'
import { Settings } from '../../components/Settings/Settings'
import { NewDMModal } from '../../components/NewDMModal/NewDMModal'
import { JoinServerModal } from '../../components/JoinServerModal/JoinServerModal'
import { CreateServerModal } from '../../components/CreateServerModal/CreateServerModal'
import { NotificationsPanel } from '../../components/NotificationsPanel/NotificationsPanel'
import { FriendsPanel } from '../../components/FriendsPanel'
import { ServerSettings } from '../../components/ServerSettings/ServerSettings'
import { ChannelSettings } from '../../components/ChannelSettings/ChannelSettings'
import { ReportModal } from '../../components/ReportModal/ReportModal'
import { UserContextMenu } from '../../components/UserContextMenu'
import { ProfileCard } from '../../components/ProfileCard/ProfileCard'
import { invalidateFriendsCache } from '../../services/friendshipCache'

import { useAppInit } from './useAppInit'
import { useAppMemos } from './useAppMemos'
import { useAppHandlers } from './useAppHandlers'

import s from '../../components/AppShell/AppShell.module.css'

export default function AppShell() {
  const init = useAppInit()
  const memos = useAppMemos(init)
  const handlers = useAppHandlers(init, memos)

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
    mentionableUsers,
    viewport, effectiveLeftCollapsed, effectiveRightCollapsed, effectiveRightMode,
  } = memos

  // ── Responsive layout helpers ──
  const isMobile = viewport.isMobile
  const showLeft  = !isMobile || activeMobilePane === 'left'
  const showChat  = !isMobile || activeMobilePane === 'chat'
  const showRight = !isMobile || activeMobilePane === 'right'

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

  const sidebarCollapsedForChannelSidebar = isMobile ? false : effectiveLeftCollapsed
  const sidebarCollapsedForChatHeader     = isMobile ? true  : effectiveLeftCollapsed
  const rightPanelHidden                   = isMobile ? false : effectiveRightCollapsed

  // ── Destructure handlers ──
  const {
    mutedServerIds, handleToggleMuteServer,
    handleLogout, handleStatusChange, handleUpdateProfile,
    handleUploadAvatar, handleTyping,
    handleSwitchServer, handleCloseTab, handleOpenServer,
    handleSend, handleToggleReaction, handleDeleteMessage, handleEditMessage,
    handlePinMessage, handleUnpinMessage, handleThemeChange,
    handleCreateChannel, handleCreateCategory, handleDeleteChannel,
    handleDeleteCategory, handleRenameChannel, handleRenameCategory, handleArchiveChannel,
    handleReorderChannels,
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

  const handleToggleRole = useCallback(async (userId: string, roleId: string, hasRole: boolean) => {
    if (!activeServerId) return
    try {
      if (hasRole) {
        await api.removeRole(activeServerId, roleId, userId)
      } else {
        await api.assignRole(activeServerId, roleId, userId)
      }
      // Refresh members to get updated role_ids
      useServersStore.getState().fetchMembersWithRoles(activeServerId).catch(console.warn)
    } catch (err) {
      console.error('Role toggle failed:', err)
    }
  }, [activeServerId])

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
          onReorder={setTabbedIds}
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
              const msg = err instanceof Error ? err.message : 'Leave server failed'
              useToast.getState().show(msg, 'error')
              console.error('Leave server failed:', err)
            }
          }}
        />

        <div className={s.contentRow}>
          <div className={s.shell}>
            <div className={s.workspace}>
              {showLeft && (!dmActive && !activeServer ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', opacity: 0.5 }}>
                  <div style={{ fontSize: '3rem' }}>👋</div>
                  <h2 className="txt-body txt-semibold">Welcome to Jolkr</h2>
                  <p className="txt-small">Join or create a server to get started, or send a direct message.</p>
                </div>
              ) : dmActive ? (
                <DMSidebar
                  conversations={uiDmList}
                  activeId={activeDmId}
                  onSelect={handleSelectDmMobile}
                  onNewMessage={() => setNewDmOpen(true)}
                  onOpenFriends={() => setFriendsPanelOpen(true)}
                  onConversationContextMenu={(conv, e) => {
                    // Group DMs don't have a single "other user" to target — skip.
                    if (conv.type !== 'direct') return
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
                />
              ) : null)}

              {showChat && <ChatArea
                channel={activeChannel}
                messages={displayMessages}
                sidebarCollapsed={sidebarCollapsedForChatHeader}
                rightPanelMode={effectiveRightMode}
                onExpandSidebar={handleExpandSidebar}
                onSetRightPanelMode={handleSetRightPanelMode}
                onSend={handleSend}
                onToggleReaction={handleToggleReaction}
                onDeleteMessage={handleDeleteMessage}
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
                onLoadOlder={() => {
                  const { fetchOlder, loadingOlder } = useMessagesStore.getState()
                  const channelId = dmActive ? activeDmId : activeChannelId
                  if (!loadingOlder[channelId]) fetchOlder(channelId, dmActive)
                }}
                hasMore={useMessagesStore.getState().hasMore[dmActive ? activeDmId : activeChannelId] ?? true}
                readOnly={isDmWithSystemUser}
                onPinMessage={handlePinMessage}
                onOpenAuthorProfile={(authorId, e) => {
                  setProfileCard({ userId: authorId, x: e.clientX, y: e.clientY })
                }}
                mentionableUsers={mentionableUsers}
                canManageMessages={canManageMessages}
                canAddReactions={canAddReactions}
                canSendMessages={canSendMessages}
                canAttachFiles={canAttachFiles}
              />}

              {showRight && (dmActive ? (
                <DMInfoPanel
                  open={!rightPanelHidden}
                  dmId={activeDmId}
                  onUnpin={handleUnpinMessage}
                  users={userMap}
                  pinnedVersion={pinnedVersion}
                  onMobileClose={isMobile ? mobileBackToChat : undefined}
                />
              ) : activeServer ? (
                <MemberPanel
                  members={activeServer.members}
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
                  users={userMap}
                  pinnedVersion={pinnedVersion}
                  onMobileClose={isMobile ? mobileBackToChat : undefined}
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
        onStartDM={async (userId) => {
          const dm = await api.openDm(userId)
          const dms = await api.getDms()
          setDmList(dms)
          setActiveDmId(dm.id)
          setDmActive(true)
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
              const msg = err instanceof Error ? err.message : 'Delete server failed'
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
              const msg = err instanceof Error ? err.message : 'Leave server failed'
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
          try {
            await api.closeDm(dmId)
            setDmList(prev => prev.filter(d => d.id !== dmId))
            if (activeDmId === dmId) {
              setActiveDmId('')
              setDmActive(false)
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
          await api.sendFriendRequest(userId).catch(console.warn)
          invalidateFriendsCache()
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
              useToast.getState().show('Invite link copied!', 'success')
            } catch {
              useToast.getState().show(`Copy failed — link: ${url}`, 'error', 6000)
            }
          } else {
            useToast.getState().show('Failed to create invite', 'error')
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
        servers={servers.filter(s => inviteableServerIds.includes(s.id)).map(s => ({ ...s, hue: serverThemes[s.id]?.hue ?? null }))}
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
        />
      )}
    </>
  )
}
