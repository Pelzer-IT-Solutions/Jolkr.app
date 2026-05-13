import { useState, useCallback, useRef } from 'react'
import * as api from '../../api/client'
import { wsClient } from '../../api/ws'
import { encryptChannelMessage } from '../../crypto/channelKeys'
import { tStatic } from '../../hooks/useT'
import { getLocalKeys } from '../../services/e2ee'
import { useAuthStore } from '../../stores/auth'
import { useMessagesStore } from '../../stores/messages'
import { usePresenceStore } from '../../stores/presence'
import { useServersStore } from '../../stores/servers'
import { useToast } from '../../stores/toast'
import { useUploadProgressStore } from '../../stores/uploadProgress'
import { useUsersStore } from '../../stores/users'
import { useVoiceStore } from '../../stores/voice'
import { buildDraftDm, isDraftDmId } from '../../utils/draftDm'
import { orbsForHue } from '../../utils/theme'
import type { useAppInit } from './useAppInit'
import type { useAppMemos } from './useAppMemos'
import type { ReplyRef, ServerTheme } from '../../types/ui'

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
    setServerThemes, lastChannelPerServer, themeSaveTimer,
    fetchServers, fetchChannels, fetchCategories,
    sendMessage, sendDmMessage, editMessage, deleteMessage,
    setPinnedCount, setPinnedVersion,
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
    const wireStatus = status === 'offline' ? 'invisible' : status
    wsClient.updatePresence(wireStatus)
  }, [user?.id])

  // ── Profile update handler ──
  const handleUpdateProfile = useCallback(async (data: { display_name?: string; bio?: string; banner_color?: string; avatar_url?: string }) => {
    const { banner_color, ...rest } = data
    await useAuthStore.getState().updateProfile({ ...rest, ...(banner_color ? { banner_color } : {}) })
  }, [])

  // ── Avatar upload handler — only uploads to S3, returns the key.
  //    The key is persisted to the profile only when the user clicks Save. ──
  const handleUploadAvatar = useCallback(async (file: File): Promise<string> => {
    const { key } = await api.uploadFile(file, 'avatar')
    return key
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
    setDmActive(false)
    setActiveServerId(id)
    // Try to restore last-used channel for this server, but only if we have fresh data
    const channels = useServersStore.getState().channels[id]
    const saved = lastChannelPerServer.current[id]
    if (channels?.length) {
      const channelExists = saved && channels.some(c => c.id === saved)
      setActiveChannelId(channelExists ? saved : (channels.find(c => c.kind === 'text')?.id ?? channels[0].id))
    }
    // If no cached channels, activeChannelId will be set by the fetch effect in useAppInit
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
    // Voice channels: join the SFU instead of switching the chat view.
    // Text channels: standard channel switch.
    const channels = useServersStore.getState().channels[activeServerId] ?? []
    const target = channels.find(c => c.id === id)
    if (target?.kind === 'voice') {
      const { connectionState, channelId: currentVoiceId, joinChannel, leaveChannel } = useVoiceStore.getState()
      if (currentVoiceId === id && connectionState !== 'disconnected') {
        // Clicking the channel you're already in — disconnect.
        void leaveChannel()
        return
      }
      void joinChannel(id, activeServerId, target.name)
      return
    }
    if (id === activeChannelId) return
    setActiveChannelId(id)
  }

  // ── Message handlers ──
  // Materialise a session-only draft DM by creating it on the server right
  // before the first message goes out. Returns the real DM channel; throws
  // if the create fails so the caller can abort the send.
  const materialiseDraftDm = useCallback(async (draftId: string) => {
    const draft = dmList.find(d => d.id === draftId)
    if (!draft) throw new Error('Draft DM not found')
    if (!user) throw new Error('No authenticated user')

    const otherIds = draft.members.filter(id => id !== user.id)
    const real = draft.is_group
      ? await api.createGroupDm(otherIds, draft.name ?? undefined)
      : await api.openDm(otherIds[0])

    // Swap the draft for the real entry; keep its position in the list so
    // the sidebar doesn't visibly re-order on send.
    setDmList(prev => {
      const idx = prev.findIndex(d => d.id === draftId)
      if (idx === -1) return prev.some(d => d.id === real.id) ? prev : [real, ...prev]
      const next = prev.slice()
      next[idx] = real
      return next
    })
    setActiveDmId(real.id)
    return real
  }, [dmList, user, setDmList, setActiveDmId])

  const handleSend = useCallback(async (text: string, replyTo?: ReplyRef, files?: File[]) => {
    let channelId = dmActive ? activeDmId : activeChannelId
    const isDm = dmActive
    const localKeys = getLocalKeys()

    if (!localKeys) {
      console.error('E2EE keys not available — cannot send message')
      return
    }

    // First-send promotion: turn the local draft into a real DM on the server
    // so the recipient gets a `DmCreate` together with this message. Failing
    // here aborts the send; we deliberately don't fall back to a fake send.
    // We also capture the resolved members directly because the closure's
    // `dmList` is stale relative to the setDmList that just ran.
    let materialisedMembers: string[] | null = null
    if (isDm && isDraftDmId(channelId)) {
      try {
        const real = await materialiseDraftDm(channelId)
        channelId = real.id
        materialisedMembers = real.members
      } catch (e) {
        console.error('Failed to create DM on first send:', e)
        useToast.getState().show((e as Error).message || tStatic('toast.startConversationFailed'), 'error')
        return
      }
    }

    // Get member IDs for key distribution (first message in channel creates the key)
    const getMemberIds = async () => {
      if (isDm) {
        if (materialisedMembers) return materialisedMembers
        const dm = dmList.find(d => d.id === channelId)
        return dm?.members ?? []
      }
      const members = membersByServer[activeServerId] ?? []
      return members.map(m => m.user_id)
    }

    const encrypted = await encryptChannelMessage(channelId, localKeys, text || ' ', getMemberIds, isDm)
    if (!encrypted) {
      console.error('E2EE encryption failed — cannot send message')
      return
    }

    // content = encrypted ciphertext, nonce = encryption nonce
    let msg
    if (isDm) {
      msg = await sendDmMessage(channelId, encrypted.encryptedContent, replyTo?.id, encrypted.nonce)
    } else {
      msg = await sendMessage(channelId, encrypted.encryptedContent, replyTo?.id, encrypted.nonce)
    }

    // Upload attachments after message is created. Surface failures via a
    // toast — silent rejections (e.g. server MIME whitelist) used to leave
    // the user with an empty message and no clue why.
    if (files?.length && msg?.id) {
      const messageId = msg.id
      const progress = useUploadProgressStore.getState()
      for (const file of files) {
        progress.startUpload(messageId, file.name, file.size)
        const onProgress = ({ loaded }: { loaded: number; total: number }) =>
          useUploadProgressStore.getState().updateProgress(messageId, file.name, loaded)
        try {
          if (isDm) {
            await api.uploadDmAttachmentWithProgress(channelId, messageId, file, onProgress)
          } else {
            await api.uploadAttachmentWithProgress(channelId, messageId, file, onProgress)
          }
          // Success — clear the in-flight row immediately. The real
          // attachment will arrive via the WS MessageUpdate event.
          useUploadProgressStore.getState().finishUpload(messageId, file.name)
        } catch (err) {
          console.error('Attachment upload failed:', err)
          const reason = err instanceof Error ? err.message : tStatic('toast.uploadFailed')
          useToast.getState().show(`${file.name}: ${reason}`, 'error', 6000)
          useUploadProgressStore.getState().failUpload(messageId, file.name, reason)
          // Auto-clear failed row after the toast fades so the message stops
          // showing the stale red error indefinitely.
          setTimeout(() => useUploadProgressStore.getState().finishUpload(messageId, file.name), 6500)
        }
      }
    }
  }, [dmActive, activeDmId, activeChannelId, activeServerId, dmList, membersByServer, materialiseDraftDm]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleReaction = useCallback((msgId: string, emoji: string) => {
    // Check if user already reacted
    const msg = currentApiMessages.find(m => m.id === msgId)
    const existing = msg?.reactions?.find(r => r.emoji === emoji)
    const onErr = (err: unknown) => {
      const m = err instanceof Error ? err.message : tStatic('toast.reactionFailed')
      useToast.getState().show(m, 'error')
      console.error('Reaction toggle failed:', err)
    }
    if (existing?.me) {
      (dmActive ? api.removeDmReaction : api.removeReaction)(msgId, emoji).catch(onErr)
    } else {
      (dmActive ? api.addDmReaction : api.addReaction)(msgId, emoji).catch(onErr)
    }
  }, [currentApiMessages, dmActive])

  const handleDeleteMessage = useCallback((msgId: string) => {
    deleteMessage(msgId, effectiveChannelId, dmActive)
  }, [effectiveChannelId, dmActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // Soft-hide a DM message for the calling user only. The server emits a
  // DmMessageHide event back to this user's other sessions; the central WS
  // dispatcher in useAppInit handles those. We still optimistically remove
  // the message locally so the active session updates immediately.
  const handleHideDmMessage = useCallback((msgId: string) => {
    if (!dmActive) return
    useMessagesStore.getState().removeMessage(effectiveChannelId, msgId)
    api.hideDmMessage(msgId).catch((err) => {
      // Re-fetch is the safest recovery — keep silent on the optimistic removal
      // since the user's intent was clear; reload only on hard failure.
      console.warn('hideDmMessage failed', err)
    })
  }, [effectiveChannelId, dmActive])

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
    const store = useMessagesStore.getState()
    const msg = (store.messages[channelId] ?? []).find(m => m.id === msgId)
    if (!msg) return
    const newPinned = !msg.is_pinned
    // Optimistic update — only change is_pinned, preserve reactions and other fields
    store.updateMessage(channelId, { ...msg, is_pinned: newPinned, reactions: undefined } as typeof msg)
    try {
      if (newPinned) {
        if (dmActive) await api.pinDmMessage(channelId, msgId)
        else await api.pinMessage(channelId, msgId)
      } else {
        if (dmActive) await api.unpinDmMessage(channelId, msgId)
        else await api.unpinMessage(channelId, msgId)
      }
      const pinned = dmActive
        ? await api.getDmPinnedMessages(channelId)
        : await api.getPinnedMessages(channelId)
      setPinnedCount(pinned.length)
      setPinnedVersion(v => v + 1)
    } catch (err) {
      console.error('Pin toggle failed:', err)
      const m = err instanceof Error ? err.message : tStatic('toast.pinFailed')
      useToast.getState().show(m, 'error')
      // Revert on failure
      const revertStore = useMessagesStore.getState()
      const revertMsg = (revertStore.messages[channelId] ?? []).find(m => m.id === msgId)
      if (revertMsg) revertStore.updateMessage(channelId, { ...revertMsg, is_pinned: msg.is_pinned, reactions: undefined } as typeof revertMsg)
    }
  }, [dmActive, activeDmId, activeChannelId, setPinnedCount, setPinnedVersion])

  const handleUnpinMessage = useCallback(async (msgId: string) => {
    const channelId = dmActive ? activeDmId : activeChannelId
    try {
      if (dmActive) await api.unpinDmMessage(channelId, msgId)
      else await api.unpinMessage(channelId, msgId)
      // Refresh pinned count
      const pinned = dmActive
        ? await api.getDmPinnedMessages(channelId)
        : await api.getPinnedMessages(channelId)
      setPinnedCount(pinned.length)
      setPinnedVersion(v => v + 1)
      // Find and update the message's is_pinned status in the store
      // Pass reactions: undefined so updateMessage preserves existing reactions
      const store = useMessagesStore.getState()
      const channelMsgs = store.messages[channelId] ?? []
      const msg = channelMsgs.find(m => m.id === msgId)
      if (msg) {
        store.updateMessage(channelId, { ...msg, is_pinned: false, reactions: undefined } as typeof msg)
      }
    } catch (err) {
      console.error('Unpin failed:', err)
      const m = err instanceof Error ? err.message : tStatic('toast.unpinFailed')
      useToast.getState().show(m, 'error')
    }
  }, [dmActive, activeDmId, activeChannelId, setPinnedCount, setPinnedVersion])

  function handleThemeChange(theme: ServerTheme) {
    setServerThemes(prev => ({ ...prev, [activeServerId]: theme }))
    // Debounce the API save — orb drags fire many rapid updates
    if (themeSaveTimer.current) clearTimeout(themeSaveTimer.current)
    themeSaveTimer.current = setTimeout(() => {
      api.updateServer(activeServerId, { theme } as Parameters<typeof api.updateServer>[1])
    }, 500)
  }

  // ── Channel CRUD handlers ──
  const handleCreateChannel = useCallback(async (name: string, kind: 'text' | 'voice', categoryId?: string) => {
    await api.createChannel(activeServerId, { name, kind, ...(categoryId ? { category_id: categoryId } : {}) })
    await fetchChannels(activeServerId)
  }, [activeServerId, fetchChannels])

  const handleCreateCategory = useCallback(async (name: string) => {
    await api.createCategory(activeServerId, { name })
    await fetchCategories(activeServerId)
    await fetchChannels(activeServerId)
  }, [activeServerId, fetchCategories, fetchChannels])

  const handleDeleteChannel = useCallback(async (channelId: string) => {
    try {
      await api.deleteChannel(channelId)
      await fetchChannels(activeServerId)
      if (channelId === activeChannelId) {
        const chs = useServersStore.getState().channels[activeServerId]
        setActiveChannelId(chs?.find(c => c.kind === 'text')?.id ?? chs?.[0]?.id ?? '')
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : tStatic('toast.deleteChannelFailed')
      useToast.getState().show(m, 'error')
      throw err
    }
  }, [activeServerId, activeChannelId, fetchChannels, setActiveChannelId])

  const handleDeleteCategory = useCallback(async (categoryId: string) => {
    if (!activeServerId) return
    await useServersStore.getState().deleteCategory(categoryId, activeServerId)
  }, [activeServerId])

  const handleArchiveChannel = useCallback(async (channelId: string) => {
    await api.updateChannel(channelId, { is_system: true })
    await fetchChannels(activeServerId)
  }, [activeServerId, fetchChannels])

  const handleRenameChannel = useCallback(async (channelId: string, newName: string) => {
    await api.updateChannel(channelId, { name: newName })
    await fetchChannels(activeServerId)
  }, [activeServerId, fetchChannels])

  const handleRenameCategory = useCallback(async (categoryId: string, newName: string) => {
    await api.updateCategory(categoryId, { name: newName })
    await fetchCategories(activeServerId)
  }, [activeServerId, fetchCategories])

  const handleReorderChannels = useCallback(async (items: api.ChannelMoveItem[]) => {
    if (!activeServerId || items.length === 0) return
    await useServersStore.getState().moveChannels(activeServerId, items)
  }, [activeServerId])

  const handleReorderCategories = useCallback(async (
    positions: Array<{ id: string; position: number }>,
  ) => {
    if (!activeServerId) return
    await useServersStore.getState().reorderCategories(activeServerId, positions)
  }, [activeServerId])

  // ── Server management ──
  async function handleJoinServer(serverId: string, accessCode: string): Promise<boolean> {
    try {
      // If access code is provided, use invite code path; otherwise join public server directly
      if (accessCode && accessCode.trim()) {
        await api.useInvite(accessCode.trim())
      } else {
        await api.joinPublicServer(serverId)
      }
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
      // Persist theme to backend
      if (data.hue != null) {
        api.updateServer(server.id, { theme: newTheme } as Parameters<typeof api.updateServer>[1])
      }
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
  // Picks up a list of usernames (one for 1-on-1, multiple for group) from
  // NewDMModal and either opens an existing conversation or sets up a
  // session-only draft. The DM is materialised on the server lazily on the
  // first message — see `materialiseDraftDm` inside `handleSend`.
  async function handleCreateDm(names: string[]) {
    if (!user) return
    try {
      // Resolve every selected name to a User in parallel; ignore unknowns.
      const resolved = (await Promise.all(
        names.map(async (name) => {
          const found = await api.searchUsers(name)
          return found.find(u => u.username === name || u.display_name === name) ?? null
        }),
      )).filter((u): u is NonNullable<typeof u> => u !== null)

      if (resolved.length === 0) return

      // Cache user objects so the sidebar can resolve names + avatars.
      setDmUsers(prev => {
        const next = new Map(prev)
        for (const u of resolved) next.set(u.id, u)
        return next
      })
      useUsersStore.getState().upsertUsers(resolved)

      const memberIds = [user.id, ...resolved.map(u => u.id)]

      // 1-on-1: reuse an existing real DM with the same partner if we already
      // have one — no point in spawning a new draft when the conversation
      // already exists on the server.
      if (resolved.length === 1) {
        const otherId = resolved[0].id
        const existing = dmList.find(d =>
          !d.is_group
          && !isDraftDmId(d.id)
          && d.members.includes(otherId)
          && d.members.length === 2,
        )
        if (existing) {
          setActiveDmId(existing.id)
          setDmActive(true)
          setNewDmOpen(false)
          return
        }
      }

      // No existing conversation — drop a draft into the sidebar. It lives
      // only in this session until the user sends a message; closing it
      // simply removes the local entry.
      const draft = buildDraftDm(memberIds)
      setDmList(prev => (prev.some(d => d.id === draft.id) ? prev : [draft, ...prev]))
      setActiveDmId(draft.id)
      setDmActive(true)
    } catch (e) {
      console.error('Failed to create DM:', e)
      useToast.getState().show((e as Error).message || tStatic('toast.createDmFailed'), 'error')
    }
    setNewDmOpen(false)
  }

  return {
    mutedServerIds, handleToggleMuteServer,
    handleLogout, handleStatusChange, handleUpdateProfile,
    handleUploadAvatar, handleChangePassword, handleTyping,
    handleSwitchServer, handleCloseTab, handleOpenServer, handleSwitchChannel,
    handleSend, handleToggleReaction, handleDeleteMessage, handleHideDmMessage, handleEditMessage,
    handlePinMessage, handleUnpinMessage, handleThemeChange,
    handleCreateChannel, handleCreateCategory, handleDeleteChannel,
    handleDeleteCategory, handleArchiveChannel,
    handleRenameChannel, handleRenameCategory,
    handleReorderChannels, handleReorderCategories,
    handleJoinServer, handleCreateServer, handleCreateDm,
  }
}
