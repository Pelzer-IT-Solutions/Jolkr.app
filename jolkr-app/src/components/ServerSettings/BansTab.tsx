import { Shield } from 'lucide-react'
import type { Ban } from '../../api/types'
import s from './ServerSettings.module.css'

interface Props {
  bans: Ban[]
  onUnban: (banId: string) => void
}

export function BansTab({ bans, onUnban }: Props) {
  return (
    <div className={s.section}>
      {bans.length === 0 ? (
        <div className={s.emptyState}>
          <div className={s.emptyStateIcon}>
            <Shield size={32} strokeWidth={1.5} />
          </div>
          <span className={`${s.emptyStateTitle} txt-small txt-medium`}>No Banned Users</span>
          <span className={`${s.emptyStateDesc} txt-small`}>Your server is clean! Banned users will appear here.</span>
        </div>
      ) : (
        <div className={s.bansList}>
          {bans.map(ban => (
            <div key={ban.id} className={s.banItem}>
              <div className={s.banInfo}>
                <div className={s.banAvatar}>?</div>
                <div className={s.banDetails}>
                  <span className={`${s.banName} txt-small txt-medium`}>
                    {ban.user_id}
                  </span>
                  <span className={s.banMeta}>
                    {ban.reason ? `Reason: ${ban.reason}` : 'No reason provided'}
                    {' · '}
                    Banned {new Date(ban.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button
                className={s.unbanBtn}
                onClick={() => onUnban(ban.id)}
              >
                Unban
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
