import { Bell } from 'lucide-react'
import { useT } from '../../hooks/useT'
import s from './NotificationsPanel.module.css'

interface Props {
  open: boolean
  onNavigate: (serverId: string, channelId: string) => void
}

export function NotificationsPanel({ open, onNavigate: _onNavigate }: Props) {
  const { t } = useT()
  return (
    <aside className={`${s.panel} ${!open ? s.hidden : ''}`}>
      <div className={s.header}>
        <span className={`${s.title} txt-tiny txt-semibold`}>{t('notificationsPanel.title')}</span>
      </div>
      <div className={s.emptyState}>
        <Bell size={98} strokeWidth={1} className={s.emptyIcon} />
        <div className={`${s.emptyText} txt-small`}>{t('notificationsPanel.empty')}</div>
      </div>
    </aside>
  )
}
