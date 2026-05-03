/**
 * Chat header — top bar of the ChatArea.
 *
 * Shows channel icon + name + topic (server context) or DM avatar(s) +
 * partner name (DM context), plus the right-side action toggles (threads /
 * pinned / members panel for server, voice/video call buttons + files panel
 * for DM). Sidebar-collapse expand button shows when the left sidebar is
 * collapsed.
 *
 * Stateless — pulls actions + flags from context, takes per-render values
 * from props.
 */
import { useCallback } from 'react'
import {
  Phone, Video, Files, PanelLeftOpen, AlignLeft, Users, Pin,
} from 'lucide-react'
import type { ChannelDisplay, DMConversation } from '../../types'
import { useCallStore } from '../../stores/call'
import { useVoiceStore } from '../../stores/voice'
import { useChatActions, useChatPermissions } from './chatContexts'
import s from './ChatArea.module.css'

interface Props {
  channel:          ChannelDisplay
  dmConversation?:  DMConversation
  sidebarCollapsed: boolean
  rightPanelMode:   'members' | 'pinned' | 'threads' | null
}

export function ChatHeader({ channel, dmConversation, sidebarCollapsed, rightPanelMode }: Props) {
  const { isDm, hasPinnedMessages, hasThreads } = useChatPermissions()
  const { onExpandSidebar, onSetRightPanelMode } = useChatActions()

  // ── Voice call wiring (DM only) ──────────────────────────────────
  // Works for both 1-on-1 and group DMs. Video calls are 1-on-1 only.
  // E2EE keys are derived only for 1-on-1; group calls fall back to
  // DTLS-SRTP only.
  const dmFirstP = dmConversation?.participants[0]
  const isGroupDm = isDm && dmConversation?.type === 'group'
  const recipientUserId = !isGroupDm ? dmFirstP?.userId : undefined
  const dmName = dmConversation?.name ?? (dmFirstP ? `@${dmFirstP.name}` : '')

  const activeCallDmId = useCallStore((st) => st.activeCallDmId)
  const incomingCall   = useCallStore((st) => st.incomingCall)
  const outgoingCall   = useCallStore((st) => st.outgoingCall)
  const startCall      = useCallStore((st) => st.startCall)
  const voiceState     = useVoiceStore((st) => st.connectionState)
  const inAnyCall      = !!activeCallDmId || !!outgoingCall || !!incomingCall || voiceState !== 'disconnected'
  const callDisabled      = !isDm || !dmConversation || inAnyCall
  const videoCallDisabled = callDisabled || isGroupDm
  const callTitle         = inAnyCall ? 'Already in a call' : 'Start voice call'
  const videoCallTitle    = inAnyCall
    ? 'Already in a call'
    : isGroupDm
      ? 'Video calls are 1-on-1 only'
      : 'Start video call'

  const handleStartCall = useCallback(() => {
    if (callDisabled || !dmConversation) return
    void startCall(dmConversation.id, dmName, recipientUserId)
  }, [callDisabled, dmConversation, dmName, recipientUserId, startCall])

  const handleStartVideoCall = useCallback(() => {
    if (videoCallDisabled || !dmConversation) return
    void startCall(dmConversation.id, dmName, recipientUserId, { video: true })
  }, [videoCallDisabled, dmConversation, dmName, recipientUserId, startCall])

  return (
    <header className={s.header}>
      {sidebarCollapsed && (
        <button className={s.iconBtn} title="Expand channels" aria-label="Expand channels" onClick={onExpandSidebar}>
          <PanelLeftOpen size={14} strokeWidth={1.5} />
        </button>
      )}

      {isDm && dmConversation ? (
        <>
          {dmConversation.type === 'group' ? (
            <div className={s.groupAvatars}>
              {dmConversation.participants.slice(0, 2).map((p, i) => (
                <div
                  key={p.userId ?? `${p.name}-${i}`}
                  className={`${s.groupAvatar} ${i === 1 ? s.groupAvatarBack : ''}`}
                  style={p.avatarUrl ? undefined : { background: p.color }}
                >
                  {p.avatarUrl
                    ? <img src={p.avatarUrl} alt={`${p.name} avatar`} width={20} height={20} style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }} />
                    : p.letter}
                </div>
              ))}
            </div>
          ) : (
            <div className={s.dmAvatar} style={dmFirstP?.avatarUrl ? undefined : { background: dmFirstP?.color }}>
              {dmFirstP?.avatarUrl
                ? <img src={dmFirstP.avatarUrl} alt={dmFirstP.name ? `${dmFirstP.name} avatar` : ''} width={28} height={28} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                : dmFirstP?.letter}
              <span className={`${s.dmStatusDot} ${s[dmFirstP?.status ?? 'offline']}`} />
            </div>
          )}
          <span className={`${s.headerName} txt-body txt-semibold`}>{dmName}</span>
        </>
      ) : (
        <>
          <span className={`${s.headerIcon} ${!sidebarCollapsed ? s.headerIconPadded : ''}`}>{channel.icon === '#' ? '#' : channel.icon}</span>
          <span className={`${s.headerName} txt-body txt-semibold`}>{channel.name}</span>
          <div className={s.headerDivider} />
          <span className={`${s.headerDesc} txt-small txt-truncate`}>{channel.desc}</span>
        </>
      )}

      <div className={s.headerActions}>
        {isDm ? (
          <>
            <button
              className={`${s.iconBtn} ${callDisabled ? s.iconBtnDisabled : ''}`}
              title={callTitle}
              aria-label={callTitle}
              disabled={callDisabled}
              onClick={handleStartCall}
            >
              <Phone size={14} strokeWidth={1.5} />
            </button>
            <button
              className={`${s.iconBtn} ${videoCallDisabled ? s.iconBtnDisabled : ''}`}
              title={videoCallTitle}
              aria-label={videoCallTitle}
              disabled={videoCallDisabled}
              onClick={handleStartVideoCall}
            >
              <Video size={14} strokeWidth={1.5} />
            </button>
            <div className={s.headerSep} />
          </>
        ) : (
          <>
            {hasThreads && (
              <button
                className={`${s.iconBtn} ${rightPanelMode === 'threads' ? s.active : ''}`}
                title="Threads"
                aria-label="Toggle threads panel"
                onClick={() => onSetRightPanelMode(rightPanelMode === 'threads' ? null : 'threads')}
              >
                <AlignLeft size={14} strokeWidth={1.5} />
              </button>
            )}
            {hasPinnedMessages && (
              <button
                className={`${s.iconBtn} ${rightPanelMode === 'pinned' ? s.active : ''}`}
                title="Pinned messages"
                aria-label="Toggle pinned messages panel"
                onClick={() => onSetRightPanelMode(rightPanelMode === 'pinned' ? null : 'pinned')}
              >
                <Pin size={14} strokeWidth={1.5} />
              </button>
            )}
          </>
        )}
        <button
          className={`${s.iconBtn} ${rightPanelMode === 'members' ? s.active : ''}`}
          title={isDm ? 'Files & pins' : 'Members'}
          aria-label={isDm ? 'Toggle files and pins panel' : 'Toggle members panel'}
          onClick={() => onSetRightPanelMode(rightPanelMode === 'members' ? null : 'members')}
        >
          {isDm ? <Files size={14} strokeWidth={1.5} /> : <Users size={14} strokeWidth={1.5} />}
        </button>
      </div>
    </header>
  )
}
