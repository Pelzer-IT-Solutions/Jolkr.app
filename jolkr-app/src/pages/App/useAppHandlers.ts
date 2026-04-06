import { useState, useCallback, useRef } from 'react'
import type { ReplyRef, ServerTheme } from '../../types/ui'
import { useAuthStore } from '../../stores/auth'
import { useServersStore } from '../../stores/servers'
import { usePresenceStore } from '../../stores/presence'
import { wsClient } from '../../api/ws'
import * as api from '../../api/client'
import { getLocalKeys } from '../../services/e2ee'
import { encryptChannelMessage } from '../../crypto/channelKeys'
import { orbsForHue } from '../../utils/theme'

import type { useAppInit } from './useAppInit'
import type { useAppMemos } from './useAppMemos'

export function useAppHandlers(
  init: ReturnType<typeof useAppInit>,
  memos: ReturnType<typeof useAppMemos>,
) {
  const {
    navigate, user, membersByServer,
    dmList, dmActive, activeDmId, activeServerId, activeChannelId,
    tabbedIds, setTabbedIds, setActiveServerId, setActiveChannelId,
    setDmActive, setActiveDmId, setDmList, setDmUsers,
    setNewDmOpen, setJoinServerOpen, setCreateServerOpen,
    setServerThemes, lastChannelPerServer,
    fetchServers, fetchChannels, fetchCategories,
    sendMessage, sendDmMessage, editMessage, deleteMessage,
  } = init

  const { uiServers, effectiveChannelId, currentApiMessages } = memos

  // ── Muted servers (UI-only local state) ──
  const [mutedServerIds, setMutedServerIds] = useState<string[]>([])
  const handleToggleMuteServer = useCallback((serverId: string) => {
    setMutedServerIds(prev =>
      prev.includes(serverId) ? prev.filter(id => id !== serverId) : [...prev, serverId]
    )
  }, [])

  // ── Logout handler ──
  const handleLogout = useCallback(async () => {
    await useAuthStore.getState().logout()
    navigate('/login')
  }, [navigate])

  // ── Status change handler ──
  const handleStatusChange = useCallback((status: string) => {
    if (user?.id) usePresenceStore.getState().setStatus(user.id, status)
    wsClient.updatePresence(status)
  }, [user?.id])

  // ── Profile update handler ──
  const handleUpdateProfile = useCallback(async (data: { display_name?: string; username?: string }) => {
    await useAuthStore.getState().updateProfile(data)
  }, [])

  // ── Avatar upload handler ──
  const handleUploadAvatar = useCallback(async (file: File) => {
    const { key } = await api.uploadFile(file, 'avatar')
    // Store the S3 key — the avatar is served via /api/avatars/:userId (no presigned URL)
    await useAuthStore.getState().updateProfile({ avatar_url: key })
  }, [])

  // ── Password change handler ──
  const handleChangePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.changePassword(currentPassword, newPassword)
  }, [])

  // ── Typing indicator (throttled) ──
  const lastTypingRef = useRef(0)
  const handleTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingRef.current < 3000) return // throttle 3s
    lastTypingRef.current = now
    const channelId = dmActive ? activeDmId : activeChannelId
    if (channelId) wsClient.sendTyping(channelId)
  }, [dmActive, activeDmId, activeChannelId])

  // ── Navigation handlers ──
  function handleSwitchServer(id: string) {
    if (id === activeServerId) return
    lastChannelPerServer.current[activeServerId] = activeChannelId
    setActiveServerId(id)
    const srv = uiServers.find(s => s.id === id)
    const saved = lastChannelPerServer.current[id]
    const channelExists = saved && srv?.channels.some(c => c.id === saved)
    setActiveChannelId(channelExists ? saved : (srv?.channels[0]?.id ?? ''))
  }

  function handleCloseTab(id: string) {
    if (tabbedIds.length === 1) return
    const idx = tabbedIds.indexOf(id)
    const next = tabbedIds.filter(t => t !== id)
    setTabbedIds(next)
    if (activeServerId === id) {
      const fallbackId = next[Math.max(0, idx - 1)]
      setActiveServerId(fallbackId)
      const srv = uiServers.find(s => s.id === fallbackId)
      setActiveChannelId(srv?.channels[0]?.id ?? '')
    }
  }

  function handleOpenServer(id: string) {
    if (!tabbedIds.includes(id)) {
      setTabbedIds(prev => [id, ...prev])
    }
    handleSwitchServer(id)
  }

  function handleSwitchChannel(id: string) {
    if (id === activeChannelId) return
    setActiveChannelId(id)
  }

  // ── Message handlers ──
  const handleSend = useCallback(async (text: string, replyTo?: ReplyRef) => {
    const channelId = dmActive ? activeDmId : activeChannelId
    const isDm = dmActive
    const localKeys = getLocalKeys()

    if (!localKeys) {
      console.error('E2EE keys not available — cannot send message')
      return
    }

    // Get member IDs for key distribution (first message in channel creates the key)
    const getMemberIds = async () => {
      if (isDm) {
        const dm = dmList.find(d => d.id === channelId)
        return dm?.members ?? []
      }
      const members = membersByServer[activeServerId] ?? []
      return members.map(m => m.user_id)
    }

    const encrypted = await encryptChannelMessage(channelId, localKeys, text, getMemberIds, isDm)
    if (!encrypted) {
      console.error('E2EE encryption failed — cannot send message')
      return
    }

    // content = encrypted ciphertext, nonce = encryption nonce
    if (isDm) {
      sendDmMessage(channelId, encrypted.encryptedContent, replyTo?.id, encrypted.nonce)
    } else {
      sendMessage(channelId, encrypted.encryptedContent, replyTo?.id, encrypted.nonce)
    }
  }, [dmActive, activeDmId, activeChannelId, activeServerId, dmList, membersByServer]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleReaction = useCallback((msgId: string, emoji: string) => {
    // Check if user already reacted
    const msg = currentApiMessages.find(m => m.id === msgId)
    const existing = msg?.reactions?.find(r => r.emoji === emoji)
    if (existing?.me) {
      (dmActive ? api.removeDmReaction : api.removeReaction)(msgId, emoji).catch(console.error)
    } else {
      (dmActive ? api.addDmReaction : api.addReaction)(msgId, emoji).catch(console.error)
    }
  }, [currentApiMessages, dmActive])

  const handleDeleteMessage = useCallback((msgId: string) => {
    deleteMessage(msgId, effectiveChannelId, dmActive)
  }, [effectiveChannelId, dmActive]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditMessage = useCallback(async (msgId: string, newText: string) => {
    const channelId = dmActive ? activeDmId : activeChannelId
    const isDm = dmActive
    const localKeys = getLocalKeys()
    if (!localKeys) return

    const getMemberIds = async () => {
      if (isDm) {
        const dm = dmList.find(d => d.id === channelId)
        return dm?.members ?? []
      }
      const members = membersByServer[activeServerId] ?? []
      return members.map(m => m.user_id)
    }

    const encrypted = await encryptChannelMessage(channelId, localKeys, newText, getMemberIds, isDm)
    if (!encrypted) return

    editMessage(msgId, effectiveChannelId, encrypted.encryptedContent, isDm, encrypted.nonce)
  }, [dmActive, activeDmId, activeChannelId, activeServerId, effectiveChannelId, dmList, membersByServer]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePinMessage = useCallback(async (msgId: string) => {
    const channelId = dmActive ? activeDmId : activeChannelId
    const msg = currentApiMessages.find(m => m.id === msgId)
    if (!msg) return
    try {
      if (msg.is_pinned) {
        if (dmActive) await api.unpinDmMessage(channelId, msgId)
        else await api.unpinMessage(channelId, msgId)
      } else {
        if (dmActive) await api.pinDmMessage(channelId, msgId)
        else await api.pinMessage(channelId, msgId)
      }
    } catch (err) {
      console.error('Pin toggle failed:', err)
    }
  }, [dmActive, activeDmId, activeChannelId, currentApiMessages])

  const handleUnpinMessage = useCallback(async (msgId: string) => {
    const channelId = dmActive ? activeDmId : activeChannelId
    try {
      if (dmActive) await api.unpinDmMessage(channelId, msgId)
      else await api.unpinMessage(channelId, msgId)
    } catch (err) {
      console.error('Unpin failed:', err)
    }
  }, [dmActive, activeDmId, activeChannelId])

  function handleThemeChange(theme: ServerTheme) {
    setServerThemes(prev => ({ ...prev, [activeServerId]: theme }))
  }

  // ── Channel CRUD handlers ──
  const handleCreateChannel = useCallback(async (name: string, kind: 'text' | 'voice') => {
    await api.createChannel(activeServerId, { name, kind })
    await fetchChannels(activeServerId)
  }, [activeServerId])

  const handleCreateCategory = useCallback(async (name: string) => {
    await api.createCategory(activeServerId, { name })
    await fetchCategories(activeServerId)
    await fetchChannels(activeServerId)
  }, [activeServerId])

  const handleDeleteChannel = useCallback(async (channelId: string) => {
    await api.deleteChannel(channelId)
    await fetchChannels(activeServerId)
    if (channelId === activeChannelId) {
      const chs = useServersStore.getState().channels[activeServerId]
      setActiveChannelId(chs?.find(c => c.kind === 'text')?.id ?? chs?.[0]?.id ?? '')
    }
  }, [activeServerId, activeChannelId])

  const handleDeleteCategory = useCallback(async (categoryId: string) => {
    await api.deleteCategory(categoryId)
    await fetchCategories(activeServerId)
    await fetchChannels(activeServerId)
  }, [activeServerId])

  const handleRenameChannel = useCallback(async (channelId: string, newName: string) => {
    await api.updateChannel(channelId, { name: newName })
    await fetchChannels(activeServerId)
  }, [activeServerId])

  const handleRenameCategory = useCallback(async (categoryId: string, newName: string) => {
    await api.updateCategory(categoryId, { name: newName })
    await fetchCategories(activeServerId)
  }, [activeServerId])

  // ── Server management ──
  async function handleJoinServer(serverId: string, _accessCode: string): Promise<boolean> {
    try {
      await api.useInvite(serverId)
      await fetchServers()
      handleOpenServer(serverId)
      setJoinServerOpen(false)
      return true
    } catch {
      return false
    }
  }

  async function handleCreateServer(data: { name: string; icon: string; color: string; hue?: number; privacy: 'public' | 'private' }) {
    try {
      const server = await api.createServer({ name: data.name, description: '' })
      await fetchServers()
      const newTheme: ServerTheme = data.hue != null
        ? { hue: data.hue, orbs: orbsForHue(data.hue) }
        : { hue: null, orbs: [] }
      setServerThemes(prev => ({ ...prev, [server.id]: newTheme }))
      setTabbedIds(prev => [...prev, server.id])
      setDmActive(false)
      setActiveServerId(server.id)
      setActiveChannelId('')
      setCreateServerOpen(false)
    } catch (e) {
      console.error('Failed to create server:', e)
    }
  }

  // ── DM creation ──
  async function handleCreateDm(names: string[]) {
    try {
      for (const name of names) {
        const found = await api.searchUsers(name)
        const foundUser = found.find(u => u.username === name || u.display_name === name)
        if (foundUser) {
          const dm = await api.openDm(foundUser.id)
          const dms = await api.getDms()
          setDmList(dms)
          // Add all DM members to user map so names resolve immediately
          setDmUsers(prev => {
            const next = new Map(prev)
            next.set(foundUser.id, foundUser)
            // Also fetch any other members we don't have yet
            for (const memberId of dm.members) {
              if (!next.has(memberId)) {
                api.getUser(memberId).then(u => {
                  if (u) setDmUsers(p => new Map(p).set(u.id, u))
                }).catch(() => {})
              }
            }
            return next
          })
          setActiveDmId(dm.id)
          setDmActive(true)
        }
      }
    } catch (e) {
      console.error('Failed to create DM:', e)
    }
    setNewDmOpen(false)
  }

  return {
    mutedServerIds, handleToggleMuteServer,
    handleLogout, handleStatusChange, handleUpdateProfile,
    handleUploadAvatar, handleChangePassword, handleTyping,
    handleSwitchServer, handleCloseTab, handleOpenServer, handleSwitchChannel,
    handleSend, handleToggleReaction, handleDeleteMessage, handleEditMessage,
    handlePinMessage, handleUnpinMessage, handleThemeChange,
    handleCreateChannel, handleCreateCategory, handleDeleteChannel,
    handleDeleteCategory, handleRenameChannel, handleRenameCategory,
    handleJoinServer, handleCreateServer, handleCreateDm,
  }
}
