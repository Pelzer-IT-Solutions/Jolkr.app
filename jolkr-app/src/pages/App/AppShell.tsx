import { useMessagesStore } from '../../stores/messages'
import { useServersStore } from '../../stores/servers'
import { useUnreadStore } from '../../stores/unread'
import { hasPermission, KICK_MEMBERS, BAN_MEMBERS } from '../../utils/permissions'
import * as api from '../../api/client'

import { TabBar } from '../../components/TabBar/TabBar'
import { ChannelSidebar } from '../../components/ChannelSidebar/ChannelSidebar'
import { DMSidebar } from '../../components/DMSidebar/DMSidebar'
import { ChatArea } from '../../components/ChatArea/ChatArea'
import { MemberPanel } from '../../components/MemberPanel/MemberPanel'
import { DMInfoPanel } from '../../components/DMInfoPanel/DMInfoPanel'
import { Settings } from '../../components/Settings/Settings'
import { NewDMModal } from '../../components/NewDMModal/NewDMModal'
import { JoinServerModal } from '../../components/JoinServerModal/JoinServerModal'
import { CreateServerModal } from '../../components/CreateServerModal/CreateServerModal'
import { NotificationsPanel } from '../../components/NotificationsPanel/NotificationsPanel'
import { PinnedMessagesPanel } from '../../components/PinnedMessagesPanel/PinnedMessagesPanel'
import { FriendsPanel } from '../../components/FriendsPanel'
import { ServerSettings } from '../../components/ServerSettings/ServerSettings'
import { ReportModal } from '../../components/ReportModal'
import { UserContextMenu } from '../../components/UserContextMenu'

import { useAppInit } from './useAppInit'
import { useAppMemos } from './useAppMemos'
import { useAppHandlers } from './useAppHandlers'

import s from '../../components/AppShell/AppShell.module.css'

export default function AppShell() {
  const init = useAppInit()
  const memos = useAppMemos(init)
  const handlers = useAppHandlers(init, memos)

  const {
    user, servers, channelsByServer, presences,
    dmActive, activeDmId, activeServerId, activeChannelId,
    tabbedIds, sidebarCollapsed, membersVisible, settingsOpen,
    newDmOpen, joinServerOpen, createServerOpen, searchActive,
    notificationsActive, friendsPanelOpen, serverSettingsOpen,
    reportTarget, userContextMenu, pinnedPanelOpen,
    setTabbedIds, setSidebarCollapsed, setMembersVisible,
    setActiveServerId, setActiveChannelId,
    setDmActive, setActiveDmId, setSettingsOpen, setNewDmOpen,
    setJoinServerOpen, setCreateServerOpen, setSearchActive,
    setNotificationsActive, setFriendsPanelOpen, setServerSettingsOpen,
    setReportTarget, setUserContextMenu, setPinnedPanelOpen,
    setDmList, ready, serverThemes,
  } = init

  const {
    isDark, colorPref, setColorPref,
    userInfo, userProfile, userMap,
    uiServers, effectiveChannelId, uiDmList,
    tabbedServers, activeServer, isServerOwner, myPerms,
    canAccessSettings, canManageChannels, ownerServerIds, settingsServerIds,
    activeTheme, chatAnimKey, typingUsers, appStyle, activeDmConv,
    isDmWithSystemUser, activeChannel, displayMessages,
    mentionableUsers,
  } = memos

  const {
    mutedServerIds, handleToggleMuteServer,
    handleLogout, handleStatusChange, handleUpdateProfile,
    handleUploadAvatar, handleChangePassword, handleTyping,
    handleSwitchServer, handleCloseTab, handleOpenServer, handleSwitchChannel,
    handleSend, handleToggleReaction, handleDeleteMessage, handleEditMessage,
    handlePinMessage, handleUnpinMessage, pinVersion, handleThemeChange,
    handleCreateChannel, handleCreateCategory, handleDeleteChannel,
    handleDeleteCategory, handleRenameChannel, handleRenameCategory,
    handleJoinServer, handleCreateServer, handleCreateDm,
  } = handlers

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
          currentUserId={user?.id ?? ''}
          currentStatus={(user?.id ? presences[user.id] : undefined) as 'online' | 'idle' | 'dnd' | 'offline' | undefined}
          ownerServerIds={ownerServerIds}
          onSwitch={id => { setDmActive(false); handleSwitchServer(id) }}
          onClose={handleCloseTab}
          onReorder={ids => { setTabbedIds(ids); useServersStore.getState().reorderServers(ids) }}
          onOpenServer={id => { setDmActive(false); handleOpenServer(id) }}
          onDmClick={() => { setDmActive(v => !v); setNotificationsActive(false) }}
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
        />

        <div className={s.contentRow}>
          <div className={s.shell}>
            <div className={s.workspace}>
              {!dmActive && !activeServer ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', opacity: 0.5 }}>
                  <div style={{ fontSize: '3rem' }}>👋</div>
                  <h2 className="txt-body txt-semibold">Welcome to Jolkr</h2>
                  <p className="txt-small">Join or create a server to get started, or send a direct message.</p>
                </div>
              ) : dmActive ? (
                <DMSidebar
                  conversations={uiDmList}
                  activeId={activeDmId}
                  onSelect={setActiveDmId}
                  onNewMessage={() => setNewDmOpen(true)}
                  onOpenFriends={() => setFriendsPanelOpen(true)}
                />
              ) : activeServer ? (
                <ChannelSidebar
                  server={activeServer}
                  activeChannelId={activeChannelId}
                  onSwitch={handleSwitchChannel}
                  onCollapse={() => setSidebarCollapsed(true)}
                  collapsed={sidebarCollapsed}
                  theme={activeTheme}
                  onThemeChange={handleThemeChange}
                  isDark={isDark}
                  colorPref={colorPref}
                  onSetColorPref={setColorPref}
                  onOpenSettings={canAccessSettings ? () => setServerSettingsOpen(true) : undefined}
                  canManageChannels={canManageChannels}
                  onCreateChannel={canManageChannels ? handleCreateChannel : undefined}
                  onCreateCategory={canManageChannels ? handleCreateCategory : undefined}
                  onDeleteChannel={canManageChannels ? handleDeleteChannel : undefined}
                  onDeleteCategory={canManageChannels ? handleDeleteCategory : undefined}
                  onRenameChannel={canManageChannels ? handleRenameChannel : undefined}
                  onRenameCategory={canManageChannels ? handleRenameCategory : undefined}
                />
              ) : null}

              <ChatArea
                channel={activeChannel}
                messages={displayMessages}
                sidebarCollapsed={dmActive ? false : sidebarCollapsed}
                membersVisible={membersVisible}
                onExpandSidebar={() => setSidebarCollapsed(false)}
                onToggleMembers={() => setMembersVisible(v => !v)}
                onSend={handleSend}
                onToggleReaction={handleToggleReaction}
                onDeleteMessage={handleDeleteMessage}
                onEditMessage={handleEditMessage}
                isDm={dmActive}
                dmConversation={dmActive ? activeDmConv : undefined}
                animationKey={chatAnimKey}
                onTyping={handleTyping}
                typingUsers={typingUsers}
                onLoadOlder={() => {
                  const { fetchOlder, loadingOlder } = useMessagesStore.getState()
                  const channelId = dmActive ? activeDmId : activeChannelId
                  if (!loadingOlder[channelId]) fetchOlder(channelId, dmActive)
                }}
                hasMore={useMessagesStore.getState().hasMore[dmActive ? activeDmId : activeChannelId] ?? true}
                readOnly={isDmWithSystemUser}
                onPinMessage={handlePinMessage}
                onTogglePinPanel={() => setPinnedPanelOpen(v => !v)}
                pinnedPanelOpen={pinnedPanelOpen}
                mentionableUsers={mentionableUsers}
              />

              {pinnedPanelOpen && (
                <PinnedMessagesPanel
                  key={`pins-${effectiveChannelId}-${pinVersion}`}
                  channelId={effectiveChannelId}
                  isDm={dmActive}
                  onClose={() => setPinnedPanelOpen(false)}
                  onUnpin={handleUnpinMessage}
                  users={userMap}
                />
              )}

              {dmActive ? (
                <DMInfoPanel visible={membersVisible} />
              ) : activeServer ? (
                <MemberPanel
                  members={activeServer.members}
                  visible={membersVisible}
                  serverId={activeServerId}
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
                />
              ) : null}
            </div>
          </div>

          {notificationsActive && (
            <NotificationsPanel
              onNavigate={(serverId, channelId) => {
                setDmActive(false)
                if (!tabbedIds.includes(serverId)) {
                  setTabbedIds(prev => [serverId, ...prev])
                }
                setActiveServerId(serverId)
                setActiveChannelId(channelId)
              }}
            />
          )}
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
          onChangePassword={handleChangePassword}
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
        isOpen={friendsPanelOpen}
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
        onRemoveFriend={async (id) => { await api.declineFriend(id) }}
      />

      {serverSettingsOpen && activeServer && (() => {
        const rawServer = servers.find(s => s.id === activeServerId)
        if (!rawServer) return null
        return (
        <ServerSettings
          server={{
            ...rawServer,
            hue: serverThemes[activeServerId]?.hue ?? null,
            discoverable: false,
          }}
          onClose={() => setServerSettingsOpen(false)}
          onUpdate={async (serverId, data) => {
            await api.updateServer(serverId, { name: data.name, description: data.description ?? undefined })
            init.fetchServers()
          }}
          onDelete={async (serverId) => {
            await api.deleteServer(serverId)
            setServerSettingsOpen(false)
            await init.fetchServers() // safety effect handles fallback
          }}
          onLeave={async (serverId) => {
            await api.leaveServer(serverId)
            setServerSettingsOpen(false)
            await init.fetchServers() // safety effect handles fallback
          }}
        />
        )
      })()}

      <ReportModal
        isOpen={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        user={reportTarget}
      />

      <UserContextMenu
        menu={userContextMenu}
        onClose={() => setUserContextMenu(null)}
        onReport={() => {
          if (userContextMenu) setReportTarget(userContextMenu.user)
          setUserContextMenu(null)
        }}
        onAddFriend={async (userId: string) => {
          await api.sendFriendRequest(userId).catch(console.warn)
          setUserContextMenu(null)
        }}
        onBlock={async (userId: string) => {
          await api.blockUser(userId).catch(console.warn)
          setUserContextMenu(null)
        }}
        onInviteToServer={async (_userId: string, serverId: string) => {
          const invite = await api.createInvite(serverId, { max_uses: 1 }).catch(() => null)
          if (invite) {
            // Copy invite link to clipboard
            const url = `${window.location.origin}/invite/${invite.code}`
            navigator.clipboard.writeText(url).catch(console.warn)
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
        servers={servers.map(s => ({ ...s, hue: serverThemes[s.id]?.hue ?? null }))}
      />
    </>
  )
}
