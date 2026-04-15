import { Bell } from 'lucide-react'
import s from './NotificationsPanel.module.css'

interface Props {
  onNavigate: (serverId: string, channelId: string) => void
}

export function NotificationsPanel({ onNavigate: _onNavigate }: Props) {
  return (
    <aside className={s.panel}>
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
