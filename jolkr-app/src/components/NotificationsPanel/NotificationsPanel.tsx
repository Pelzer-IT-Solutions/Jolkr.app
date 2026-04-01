import { Bell } from 'lucide-react'
import s from './NotificationsPanel.module.css'

interface Props {
  onNavigate: (serverId: string, channelId: string) => void
}

export function NotificationsPanel({ onNavigate: _onNavigate }: Props) {
  return (
    <aside className={s.panel}>
      <div className={s.header}>
        <Bell size={14} strokeWidth={1.5} />
        <span className={`${s.title} txt-small txt-semibold`}>Notifications</span>
      </div>
      <div className={s.emptyState} style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <Bell size={32} strokeWidth={1} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
        <div className="txt-small">No notifications yet</div>
      </div>
    </aside>
  )
}
