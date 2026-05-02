import { Bell } from 'lucide-react'
import s from './NotificationsPanel.module.css'

interface Props {
  open: boolean
  onNavigate: (serverId: string, channelId: string) => void
}

export function NotificationsPanel({ open, onNavigate: _onNavigate }: Props) {
  return (
    <aside className={`${s.panel} ${!open ? s.hidden : ''}`}>
      <div className={s.header}>
        <span className={`${s.title} txt-tiny txt-semibold`}>Notifications</span>
      </div>
      <div className={s.emptyState}>
        <Bell size={98} strokeWidth={1} className={s.emptyIcon} />
        <div className={`${s.emptyText} txt-small`}>No notifications yet</div>
      </div>
    </aside>
  )
}
