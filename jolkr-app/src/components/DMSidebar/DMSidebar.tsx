import { SquarePen, Users } from 'lucide-react'
import type { DMConversation } from '../../types'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import Avatar from '../Avatar'
import s from './DMSidebar.module.css'

interface Props {
  conversations: DMConversation[]
  activeId:      string
  onSelect:      (id: string) => void
  onNewMessage:  () => void
  onOpenFriends?: () => void
}

export function DMSidebar({ conversations, activeId, onSelect, onNewMessage, onOpenFriends }: Props) {
  return (
    <aside className={s.sidebar}>
      <div className={s.header}>
        <span className={`${s.title} txt-small txt-semibold`}>Direct Messages</span>
        <div className={s.actions}>
          {onOpenFriends && (
            <button className={s.iconBtn} title="Friends" onClick={onOpenFriends}><Users size={14} strokeWidth={1.5} /></button>
          )}
          <button className={s.iconBtn} title="New message" onClick={onNewMessage}><ComposeIcon /></button>
        </div>
      </div>

      <div className={`${s.scroll} scrollbar-thin scroll-view-y`}>
        {conversations.length === 0 && (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', opacity: 0.4 }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💬</div>
            <p className="txt-small">No conversations yet</p>
            <p className="txt-tiny" style={{ marginTop: '0.25rem' }}>Start a new message to begin chatting</p>
          </div>
        )}
        {conversations.map(conv => {
          const displayName = conv.name ?? conv.participants[0]?.name ?? 'Unknown'
          const isActive    = conv.id === activeId
          return (
            <button
              key={conv.id}
              className={`${s.conv} ${isActive ? s.active : ''}`}
              onClick={() => onSelect(conv.id)}
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
        <div key={i} className={`${s.groupAvatar} ${i === 1 ? s.groupAvatarBack : ''}`}>
          <Avatar url={p.avatarUrl} name={p.name} size="xs" userId={p.userId} color={p.color} />
        </div>
      ))}
    </div>
  )
}

function DmPreview({ content, nonce, channelId }: { content: string; nonce?: string | null; channelId: string }) {
  const { displayContent, decrypting } = useDecryptedContent(content, nonce, true, channelId)
  if (decrypting) return <span className={`${s.preview} txt-tiny txt-truncate`}>...</span>
  // Don't show the "[Encrypted message — keys unavailable]" placeholder
  if (displayContent.startsWith('[Encrypted')) return <span className={`${s.preview} txt-tiny txt-truncate`}>Encrypted message</span>
  return <span className={`${s.preview} txt-tiny txt-truncate`}>{displayContent.slice(0, 80)}</span>
}

function ComposeIcon() { return <SquarePen size={14} strokeWidth={1.5} /> }
