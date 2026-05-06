import { ScrollText } from 'lucide-react'
import type { AuditLogEntry, Member } from '../../api/types'
import s from './ServerSettings.module.css'

const ACTION_ICONS: Record<string, string> = {
  'MemberJoin': '👤',
  'MemberLeave': '👋',
  'MemberUpdate': '✏️',
  'ChannelCreate': '📝',
  'ChannelUpdate': '📋',
  'ChannelDelete': '🗑️',
  'RoleCreate': '🛡️',
  'RoleUpdate': '⚙️',
  'RoleDelete': '❌',
  'ServerUpdate': '🔧',
  'ServerDelete': '💥',
  'BanCreate': '🔨',
  'BanDelete': '🔓',
  'Kick': '👢',
}

const FALLBACK_ICON = '📌'

const ACTION_LABELS: Record<string, string> = {
  'MemberJoin': 'Member Joined',
  'MemberLeave': 'Member Left',
  'MemberUpdate': 'Member Updated',
  'ChannelCreate': 'Channel Created',
  'ChannelUpdate': 'Channel Updated',
  'ChannelDelete': 'Channel Deleted',
  'RoleCreate': 'Role Created',
  'RoleUpdate': 'Role Updated',
  'RoleDelete': 'Role Deleted',
  'ServerUpdate': 'Server Updated',
  'ServerDelete': 'Server Deleted',
  'BanCreate': 'User Banned',
  'BanDelete': 'User Unbanned',
  'Kick': 'User Kicked',
}

function AuditIcon({ actionType }: { actionType: string }) {
  return <span className={s.auditIconInner}>{ACTION_ICONS[actionType] ?? FALLBACK_ICON}</span>
}

function formatActionType(actionType: string): string {
  return ACTION_LABELS[actionType] ?? actionType.replace(/([A-Z])/g, ' $1').trim()
}

interface Props {
  auditLog: AuditLogEntry[]
  members: Member[]
}

export function AuditTab({ auditLog, members }: Props) {
  if (auditLog.length === 0) {
    return (
      <div className={s.section}>
        <div className={s.emptyState}>
          <div className={s.emptyStateIcon}>
            <ScrollText size={32} strokeWidth={1.5} />
          </div>
          <span className={`${s.emptyStateTitle} txt-small txt-medium`}>No Activity Yet</span>
          <span className={`${s.emptyStateDesc} txt-small`}>Audit log entries will appear here when server actions are performed.</span>
        </div>
      </div>
    )
  }

  // Group entries by day
  const grouped = auditLog.reduce((acc, entry) => {
    const date = new Date(entry.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    if (!acc[date]) acc[date] = []
    acc[date].push(entry)
    return acc
  }, {} as Record<string, typeof auditLog>)

  return (
    <div className={s.section}>
      <div className={s.auditList}>
        {Object.entries(grouped).map(([date, entries]) => (
          <div key={date} className={s.auditDayGroup}>
            <div className={s.auditDayHeader}>{date}</div>
            <div className={s.auditDayEntries}>
              {entries.map(entry => (
                <div key={entry.id} className={s.auditItem}>
                  <div className={s.auditIcon}>
                    <AuditIcon actionType={entry.action_type} />
                  </div>
                  <div className={s.auditContent}>
                    <div className={s.auditHeader}>
                      <span className={`${s.auditAction} txt-small txt-medium`}>
                        {formatActionType(entry.action_type)}
                      </span>
                      <span className={`${s.auditTime} txt-tiny`}>
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className={s.auditDetails}>
                      <span className={`${s.auditUser} txt-tiny`}>
                        by {members.find(m => m.user_id === entry.user_id)?.nickname || entry.user_id}
                      </span>
                      {entry.target_type && entry.target_id && (
                        <span className={`${s.auditTarget} txt-tiny`}>
                          {' '}on {entry.target_type}: {entry.target_id.slice(0, 8)}...
                        </span>
                      )}
                    </div>
                    {entry.reason && (
                      <span className={`${s.auditReason} txt-tiny`}>
                        Reason: {entry.reason}
                      </span>
                    )}
                    {entry.changes && Object.keys(entry.changes).length > 0 && (
                      <div className={s.auditChanges}>
                        {Object.entries(entry.changes).map(([key, value]) => (
                          <span key={key} className={`${s.changeItem} txt-tiny`}>
                            {key}: {JSON.stringify(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
