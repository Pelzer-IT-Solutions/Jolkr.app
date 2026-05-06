import { useState } from 'react'
import { Link2, Check, Copy } from 'lucide-react'
import type { Invite } from '../../api/types'
import * as api from '../../api/client'
import { buildInviteUrl } from '../../platform/config'
import { useToast } from '../../stores/toast'
import { Select } from '../ui/Select'
import s from './ServerSettings.module.css'

interface Props {
  serverId: string
  invites: Invite[]
  setInvites: React.Dispatch<React.SetStateAction<Invite[]>>
}

export function InvitesTab({ serverId, invites, setInvites }: Props) {
  const showToast = useToast(s => s.show)
  const [createInviteMaxAge, setCreateInviteMaxAge] = useState<number>(86400) // 1 day default
  const [createInviteMaxUses, setCreateInviteMaxUses] = useState<number>(0) // 0 = unlimited
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [createInviteError, setCreateInviteError] = useState('')
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)

  const handleCreate = async () => {
    setCreatingInvite(true)
    setCreateInviteError('')
    try {
      const body: { max_uses?: number; max_age_seconds?: number } = {}
      if (createInviteMaxUses > 0) body.max_uses = createInviteMaxUses
      if (createInviteMaxAge > 0) body.max_age_seconds = createInviteMaxAge
      const created = await api.createInvite(serverId, Object.keys(body).length > 0 ? body : undefined)
      setInvites(prev => [created, ...prev])
    } catch (e) {
      setCreateInviteError((e as Error).message || 'Failed to create invite')
    } finally {
      setCreatingInvite(false)
    }
  }

  const handleCopy = async (invite: Invite) => {
    const url = buildInviteUrl(invite.code)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedInviteId(invite.id)
      showToast('Invite link copied!', 'success')
      setTimeout(() => setCopiedInviteId(prev => prev === invite.id ? null : prev), 2000)
    } catch {
      // Clipboard API can fail when the window isn't focused — show the URL so the user can copy manually
      showToast(`Copy failed — link: ${url}`, 'error', 6000)
    }
  }

  const handleDelete = async (inviteId: string) => {
    try {
      await api.deleteInvite(serverId, inviteId)
      setInvites(prev => prev.filter(inv => inv.id !== inviteId))
    } catch (e) { console.warn('Failed to delete invite:', e) }
  }

  return (
    <div className={s.section}>
      <div className={s.inviteCreateRow}>
        <div className={s.inviteCreateField}>
          <label className={`${s.inviteCreateLabel} txt-tiny txt-semibold`}>Expire after</label>
          <Select
            value={createInviteMaxAge}
            onChange={e => setCreateInviteMaxAge(Number(e.target.value))}
            disabled={creatingInvite}
          >
            <option value={0}>Never</option>
            <option value={1800}>30 minutes</option>
            <option value={3600}>1 hour</option>
            <option value={21600}>6 hours</option>
            <option value={43200}>12 hours</option>
            <option value={86400}>1 day</option>
            <option value={604800}>7 days</option>
          </Select>
        </div>
        <div className={s.inviteCreateField}>
          <label className={`${s.inviteCreateLabel} txt-tiny txt-semibold`}>Max uses</label>
          <Select
            value={createInviteMaxUses}
            onChange={e => setCreateInviteMaxUses(Number(e.target.value))}
            disabled={creatingInvite}
          >
            <option value={0}>No limit</option>
            <option value={1}>1 use</option>
            <option value={5}>5 uses</option>
            <option value={10}>10 uses</option>
            <option value={25}>25 uses</option>
            <option value={50}>50 uses</option>
            <option value={100}>100 uses</option>
          </Select>
        </div>
        <button
          className={`${s.createBtn} ${s.inviteRowBtn}`}
          onClick={handleCreate}
          disabled={creatingInvite}
        >
          <Link2 size={14} strokeWidth={1.5} />
          {creatingInvite ? 'Creating…' : 'Create Invite'}
        </button>
      </div>

      {createInviteError && (
        <div className={s.inviteError}>{createInviteError}</div>
      )}

      {invites.length === 0 ? (
        <div className={s.emptyState}>
          <div className={s.emptyStateIcon}>
            <Link2 size={32} strokeWidth={1.5} />
          </div>
          <span className={`${s.emptyStateTitle} txt-small txt-medium`}>No Invites Yet</span>
          <span className={`${s.emptyStateDesc} txt-small`}>Create an invite above to start inviting people to your server.</span>
        </div>
      ) : (
        <>
          <div className={s.sectionHeaderWithTitle}>
            <span className={`${s.sectionTitle} txt-tiny txt-semibold`}>All Invites</span>
          </div>
          <div className={s.invitesList}>
            {invites.map(invite => (
              <div key={invite.id} className={s.inviteItem}>
                <div className={s.inviteInfo}>
                  <button
                    type="button"
                    className={s.inviteCopyBtn}
                    onClick={() => handleCopy(invite)}
                    title="Click to copy invite link"
                  >
                    <code className={s.inviteCode}>{invite.code}</code>
                    {copiedInviteId === invite.id
                      ? <Check size={13} strokeWidth={1.75} />
                      : <Copy size={13} strokeWidth={1.5} />}
                  </button>
                  <span className={`${s.inviteMeta} txt-tiny`}>
                    {invite.use_count} / {invite.max_uses ?? '∞'} uses
                    {invite.expires_at && ` · Expires ${new Date(invite.expires_at).toLocaleString()}`}
                  </span>
                </div>
                <button
                  className={s.revokeBtn}
                  onClick={() => handleDelete(invite.id)}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
