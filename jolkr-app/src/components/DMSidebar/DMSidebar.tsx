import { SquarePen, Users, PanelLeftClose, ArrowLeft } from 'lucide-react'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { useT } from '../../hooks/useT'
import { Avatar } from '../Avatar/Avatar'
import s from './DMSidebar.module.css'
import type { DMConversation } from '../../types'

interface Props {
  conversations: DMConversation[]
  activeId:      string
  onSelect:      (id: string) => void
  onNewMessage:  () => void
  onOpenFriends?: () => void
  /** Right-click on a DM row. Direct conversations open `UserContextMenu`,
   *  group conversations open `GroupContextMenu` — the branch lives in the
   *  parent so this component stays agnostic of which menu fires. */
  onConversationContextMenu?: (conv: DMConversation, e: React.MouseEvent) => void
  collapsed?:     boolean
  onCollapse?:    () => void
  isMobile?:      boolean
}

export function DMSidebar({ conversations, activeId, onSelect, onNewMessage, onOpenFriends, onConversationContextMenu, collapsed = false, onCollapse, isMobile = false }: Props) {
  const { t } = useT()
  return (
    <aside className={`${s.sidebar} ${collapsed ? s.collapsed : ''}`}>
      <div className={s.header}>
        {isMobile && onCollapse && (
          <button className={s.iconBtn} title={t('dmSidebar.backToChat')} aria-label={t('dmSidebar.backToChat')} onClick={onCollapse}>
            <ArrowLeft size={14} strokeWidth={1.5} />
          </button>
        )}
        <span className={`${s.title} txt-small txt-semibold`}>{t('dmSidebar.title')}</span>
        <div className={s.actions}>
          {onOpenFriends && (
            <button className={s.iconBtn} title={t('dmSidebar.friends')} aria-label={t('dmSidebar.friends')} onClick={onOpenFriends}><Users size={14} strokeWidth={1.5} /></button>
          )}
          <button className={s.iconBtn} title={t('dmSidebar.newMessage')} aria-label={t('dmSidebar.newMessage')} onClick={onNewMessage}><ComposeIcon /></button>
          {!isMobile && onCollapse && (
            <button className={s.iconBtn} title={t('dmSidebar.collapseSidebar')} aria-label={t('dmSidebar.collapseSidebar')} onClick={onCollapse}>
              <PanelLeftClose size={14} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      <div className={`${s.scroll} scrollbar-thin scroll-view-y`}>
        {conversations.length === 0 && (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', opacity: 0.4 }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💬</div>
            <p className="txt-small">{t('dmSidebar.emptyTitle')}</p>
            <p className="txt-tiny" style={{ marginTop: '0.25rem' }}>{t('dmSidebar.emptySubtitle')}</p>
          </div>
        )}
        {conversations.map(conv => {
          const displayName = conv.name ?? conv.participants[0]?.name ?? t('common.unknown')
          const isActive    = conv.id === activeId
          return (
            <button
              key={conv.id}
              className={`${s.conv} ${isActive ? s.active : ''}`}
              onClick={() => onSelect(conv.id)}
              onContextMenu={(e) => {
                if (!onConversationContextMenu) return
                e.preventDefault()
                onConversationContextMenu(conv, e)
              }}
            >
              <ConvAvatar conv={conv} />
              <div className={s.meta}>
                <span className={`${s.convName} txt-small txt-medium txt-truncate`}>{displayName}</span>
                {conv.lastMessage && (
                  <DmPreview content={conv.lastMessage} nonce={conv.lastMessageNonce} channelId={conv.id} />
                )}
              </div>
              <div className={s.convRight}>
                {conv.lastTime && (
                  <span className={`${s.time} txt-tiny`}>{conv.lastTime}</span>
                )}
                {conv.unread > 0 && (
                  <span className={s.badge}>{conv.unread}</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function ConvAvatar({ conv }: { conv: DMConversation }) {
  if (conv.type === 'direct') {
    const p = conv.participants[0]
    if (!p) return <Avatar url={null} name="?" size="sm" />
    return <Avatar url={p.avatarUrl} name={p.name} size="sm" status={p.status} userId={p.userId} color={p.color} />
  }
  return (
    <div className={s.groupAvatars}>
      {conv.participants.slice(0, 2).map((p, i) => (
        <div key={p.userId ?? `slot-${i}`} className={`${s.groupAvatar} ${i === 1 ? s.groupAvatarBack : ''}`}>
          <Avatar url={p.avatarUrl} name={p.name} size="xs" userId={p.userId} color={p.color} />
        </div>
      ))}
    </div>
  )
}

function DmPreview({ content, nonce, channelId }: { content: string; nonce?: string | null; channelId: string }) {
  const { t } = useT()
  const { displayContent, decrypting } = useDecryptedContent(content, nonce, true, channelId)
  if (decrypting) return <span className={`${s.preview} txt-tiny txt-truncate`}>...</span>
  // Don't show the "[Encrypted message — keys unavailable]" placeholder
  if (displayContent.startsWith('[')) return <span className={`${s.preview} txt-tiny txt-truncate`}>{t('message.decrypt.encryptedMessage')}</span>
  return <span className={`${s.preview} txt-tiny txt-truncate`} dir="auto">{displayContent.slice(0, 80)}</span>
}

function ComposeIcon() { return <SquarePen size={14} strokeWidth={1.5} /> }
