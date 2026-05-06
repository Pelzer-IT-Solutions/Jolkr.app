import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Info, Users, Shield, Link2, ScrollText, Trash2,
} from 'lucide-react'
import type { Invite, Ban, AuditLogEntry } from '../../api/types'
import type { Server as ApiServer, Member } from '../../api/types'
import * as api from '../../api/client'
import { useAuthStore } from '../../stores/auth'
import ServerIcon from '../ServerIcon/ServerIcon'
import { SettingsShell, type SettingsNavGroup } from '../SettingsShell'
import { OverviewTab } from './OverviewTab'
import { BansTab } from './BansTab'
import { AuditTab } from './AuditTab'
import { InvitesTab } from './InvitesTab'
import { RolesTab } from './RolesTab'
import { useRoleEdit } from './useRoleEdit'

// Extend API Server with frontend-only display fields
type Server = ApiServer & { hue?: number | null; discoverable?: boolean }
import s from './ServerSettings.module.css'

type Section = 'overview' | 'roles' | 'invites' | 'bans' | 'audit' | 'delete'

interface Props {
  server: Server
  onClose: () => void
  onUpdate: (serverId: string, data: Partial<Server>) => void
  onDelete?: (serverId: string) => void
  onLeave?: (serverId: string) => void
}

const NAV: { group: string; items: { id: Section; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: 'Server Settings',
    items: [
      { id: 'overview', label: 'Overview', icon: <Info size={15} strokeWidth={1.5} /> },
      { id: 'roles', label: 'Roles', icon: <Shield size={15} strokeWidth={1.5} /> },
      { id: 'invites', label: 'Invites', icon: <Link2 size={15} strokeWidth={1.5} /> },
    ],
  },
  {
    group: 'Moderation',
    items: [
      { id: 'bans', label: 'Bans', icon: <Shield size={15} strokeWidth={1.5} /> },
      { id: 'audit', label: 'Audit Log', icon: <ScrollText size={15} strokeWidth={1.5} /> },
    ],
  },
  {
    group: 'Danger Zone',
    items: [
      { id: 'delete', label: 'Delete Server', icon: <Trash2 size={15} strokeWidth={1.5} /> },
    ],
  },
]

export function ServerSettings({ server, onClose, onUpdate, onDelete, onLeave }: Props) {
  const currentUserId = useAuthStore(s => s.user?.id)
  const isOwner = currentUserId === server.owner_id
  const [section, setSection] = useState<Section>('overview')
  const [editedServer, setEditedServer] = useState<Partial<Server>>({})
  const [hasChanges, setHasChanges] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [iconPreviewUrl, setIconPreviewUrl] = useState<string | null>(null)
  const iconFileRef = useRef<HTMLInputElement | null>(null)

  const [invites, setInvites] = useState<Invite[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [bans, setBans] = useState<Ban[]>([])
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])

  // Role list + editing — owned by useRoleEdit. The hook does its own
  // api.getRoles fetch; the rest of the data sits in this useEffect.
  const roleEdit = useRoleEdit({ serverId: server.id, setMembers })
  const roles = roleEdit.roles

  // Load remaining server data (members / invites / bans / audit log).
  useEffect(() => {
    const id = server.id
    api.getMembersWithRoles(id).then(setMembers).catch(() => setMembers([]))
    api.getInvites(id).then(setInvites).catch(() => setInvites([]))
    api.getBans(id).then(setBans).catch(() => setBans([]))
    api.getAuditLog(id).then(setAuditLog).catch(() => setAuditLog([]))
  }, [server.id])

  // Ban management handlers
  const handleUnban = async (banId: string) => {
    const ban = bans.find(b => b.id === banId)
    if (!ban) return
    try {
      await api.unbanMember(server.id, ban.user_id)
      setBans(prev => prev.filter(b => b.id !== banId))
    } catch (e) { console.warn('Failed to unban:', e) }
  }

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await api.uploadFile(file, 'icon')
      setEditedServer(prev => ({ ...prev, icon_url: result.key }))
      setHasChanges(true)
      setIconPreviewUrl(URL.createObjectURL(file))
    } catch { /* ignore */ }
  }

  // Compose nav groups for the shell — counts and the danger variant for
  // Delete Server are computed per-render from the loaded data.
  const navGroups: SettingsNavGroup<Section>[] = useMemo(() => NAV.map(group => ({
    group: group.group,
    items: group.items.map(item => {
      let count: number | undefined
      if (item.id === 'roles') count = roles.length
      else if (item.id === 'invites') count = invites.length
      else if (item.id === 'bans') count = bans.length
      else if (item.id === 'audit') count = auditLog.length
      return {
        id: item.id,
        label: item.label,
        icon: item.icon,
        count,
        variant: item.id === 'delete' ? ('danger' as const) : undefined,
      }
    }),
  })), [roles.length, invites.length, bans.length, auditLog.length])

  return (
    <>
    <SettingsShell
      section={section}
      onSection={setSection}
      onClose={onClose}
      navGroups={navGroups}
      navHeader={
        <div className={s.serverHeader}>
          <ServerIcon name={server.name} iconUrl={server.icon_url} serverId={server.id} size="sm" />
          <span className={`${s.serverName} txt-small txt-semibold`}>{server.name}</span>
        </div>
      }
      navFooter={!isOwner ? (
        <button className={s.leaveBtn} onClick={() => setShowLeaveConfirm(true)}>
          <Users size={14} strokeWidth={1.5} />
          <span className="txt-small">Leave Server</span>
        </button>
      ) : undefined}
      scrollNoPadding={section === 'roles'}
    >
            {/* Overview Section */}
            {section === 'overview' && (
              <OverviewTab
                server={server}
                editedServer={editedServer}
                setEditedServer={setEditedServer}
                hasChanges={hasChanges}
                setHasChanges={setHasChanges}
                iconPreviewUrl={iconPreviewUrl}
                setIconPreviewUrl={setIconPreviewUrl}
                iconFileRef={iconFileRef}
                onUpdate={onUpdate}
                onIconUpload={handleIconUpload}
              />
            )}

            {/* Roles Section */}
            {section === 'roles' && <RolesTab edit={roleEdit} />}

            {/* Invites Section */}
            {section === 'invites' && (
              <InvitesTab
                serverId={server.id}
                invites={invites}
                setInvites={setInvites}
              />
            )}

            {/* Bans Section */}
            {section === 'bans' && (
              <BansTab bans={bans} onUnban={handleUnban} />
            )}

            {/* Audit Log Section */}
            {section === 'audit' && (
              <AuditTab auditLog={auditLog} members={members} />
            )}

            {/* Delete Server Section */}
            {section === 'delete' && (
              <div className={s.section}>
                <div className={s.dangerZone}>
                  <h3 className={`${s.dangerTitle} txt-small txt-semibold`}>Delete Server</h3>
                  <p className={`${s.dangerText} txt-small`}>
                    This action cannot be undone. All channels, messages, and data will be permanently deleted.
                  </p>
                  <button
                    className={s.deleteBtn}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                    <span>Delete Server</span>
                  </button>
                </div>
              </div>
            )}
    </SettingsShell>

    {/* Leave Confirmation Modal — rendered as a separate portal sibling so it
        floats on top of the SettingsShell modal with its own backdrop. */}
    {showLeaveConfirm && createPortal(
      <div className={s.confirmOverlay} onClick={() => setShowLeaveConfirm(false)}>
        <div className={s.confirmModal}>
          <h3 className="txt-small txt-semibold">Leave Server</h3>
          <p className={`${s.confirmText} txt-small`}>
            Are you sure you want to leave <strong>{server.name}</strong>? You won't be able to rejoin unless you have an invite.
          </p>
          <div className={s.confirmActions}>
            <button className={s.cancelBtn} onClick={() => setShowLeaveConfirm(false)}>Cancel</button>
            <button
              className={s.confirmLeaveBtn}
              onClick={() => { onLeave?.(server.id); onClose() }}
            >
              Leave Server
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}

    {/* Delete Confirmation Modal */}
    {showDeleteConfirm && createPortal(
      <div className={s.confirmOverlay} onClick={() => setShowDeleteConfirm(false)}>
        <div className={s.confirmModal}>
          <h3 className="txt-small txt-semibold">Delete Server</h3>
          <p className={`${s.confirmText} txt-small`}>
            Are you sure you want to permanently delete <strong>{server.name}</strong>? This action cannot be undone.
          </p>
          <div className={s.confirmActions}>
            <button className={s.cancelBtn} onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
            <button
              className={s.confirmDeleteBtn}
              onClick={() => { onDelete?.(server.id); onClose() }}
            >
              Delete Server
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}
    </>
  )
}

