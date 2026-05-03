import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Info, Users, Shield, Link2, ScrollText, Trash2, Save, Plus, Check
} from 'lucide-react'
import type { Invite, Role, Ban, AuditLogEntry } from '../../api/types'
import type { Server as ApiServer, Member } from '../../api/types'
import * as api from '../../api/client'
import * as P from '../../utils/permissions'
import { useAuthStore } from '../../stores/auth'
import ServerIcon from '../ServerIcon/ServerIcon'
import { SettingsShell, type SettingsNavGroup } from '../SettingsShell'
import { OverviewTab } from './OverviewTab'
import { BansTab } from './BansTab'
import { AuditTab } from './AuditTab'
import { InvitesTab } from './InvitesTab'

// Extend API Server with frontend-only display fields
type Server = ApiServer & { hue?: number | null; discoverable?: boolean }
import s from './ServerSettings.module.css'

type Section = 'overview' | 'roles' | 'invites' | 'bans' | 'audit' | 'delete'

/** API returns roles by position DESC; UI shows oldest / lowest position first (new roles at the end). */
function sortRolesByPosition(roles: Role[]): Role[] {
  return [...roles].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position
    return a.name.localeCompare(b.name)
  })
}

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
  const [roles, setRoles] = useState<Role[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [bans, setBans] = useState<Ban[]>([])
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])

  // Role editing state
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [editingRoleName, setEditingRoleName] = useState('')
  const [editingRoleColor, setEditingRoleColor] = useState('#000000')
  const [editingRolePermissions, setEditingRolePermissions] = useState<number>(0)
  // Store original values to detect changes and support cancel
  const [originalRoleName, setOriginalRoleName] = useState('')
  const [originalRoleColor, setOriginalRoleColor] = useState('#000000')
  const [originalRolePermissions, setOriginalRolePermissions] = useState<number>(0)
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)

  // Load real data from API
  useEffect(() => {
    const id = server.id
    api.getRoles(id).then((loadedRoles) => {
      setRoles(loadedRoles)
      // Always auto-select first role when roles are loaded (oldest / lowest position, e.g. @everyone)
      const ordered = sortRolesByPosition(loadedRoles)
      if (ordered.length > 0) {
        const firstRole = ordered[0]
        setSelectedRoleId(firstRole.id)
        // Initialize editing state for the first role
        const colorHex = `#${firstRole.color.toString(16).padStart(6, '0')}`
        setEditingRoleId(firstRole.id)
        setEditingRoleName(firstRole.name)
        setEditingRoleColor(colorHex)
        setEditingRolePermissions(firstRole.permissions)
        setOriginalRoleName(firstRole.name)
        setOriginalRoleColor(colorHex)
        setOriginalRolePermissions(firstRole.permissions)
      }
    }).catch(() => setRoles([]))
    api.getMembersWithRoles(id).then(setMembers).catch(() => setMembers([]))
    api.getInvites(id).then(setInvites).catch(() => setInvites([]))
    api.getBans(id).then(setBans).catch(() => setBans([]))
    api.getAuditLog(id).then(setAuditLog).catch(() => setAuditLog([]))
  }, [server.id])

  const rolesOrdered = useMemo(() => sortRolesByPosition(roles), [roles])

  // Ban management handlers
  const handleUnban = async (banId: string) => {
    const ban = bans.find(b => b.id === banId)
    if (!ban) return
    try {
      await api.unbanMember(server.id, ban.user_id)
      setBans(prev => prev.filter(b => b.id !== banId))
    } catch (e) { console.warn('Failed to unban:', e) }
  }

  // Role management handlers
  const handleCreateRole = async () => {
    // Find the next available default name
    const baseName = 'new_role'
    let nextNum = 1
    const existingNames = new Set(roles.map(r => r.name))
    while (existingNames.has(`${baseName}_${nextNum}`)) {
      nextNum++
    }
    const defaultName = `${baseName}_${nextNum}`
    const defaultColor = 0x5865F2 // Default blue color

    try {
      const newRole = await api.createRole(server.id, {
        name: defaultName,
        color: defaultColor,
        permissions: 0,
      })
      setRoles(prev => [...prev, newRole])
      // Auto-select the new role and initialize edit state
      setSelectedRoleId(newRole.id)
      setEditingRoleId(newRole.id)
      setEditingRoleName(newRole.name)
      setEditingRoleColor(`#${newRole.color.toString(16).padStart(6, '0')}`)
      setEditingRolePermissions(newRole.permissions)
      // Store original values (same as new since it's fresh)
      setOriginalRoleName(newRole.name)
      setOriginalRoleColor(`#${newRole.color.toString(16).padStart(6, '0')}`)
      setOriginalRolePermissions(newRole.permissions)
    } catch (e) { console.warn('Failed to create role:', e) }
  }

  const handlePermissionToggle = (permissionFlag: number) => {
    setEditingRolePermissions(prev => {
      const hasPerm = (prev & permissionFlag) === permissionFlag
      if (hasPerm) {
        return prev & ~permissionFlag
      } else {
        return prev | permissionFlag
      }
    })
  }

  const handleSelectRole = (roleId: string) => {
    // Radio button behavior: always have one selected, can't unselect
    if (selectedRoleId === roleId) {
      // Clicking already selected role does nothing
      return
    }

    // Select the new role
    setSelectedRoleId(roleId)

    // Initialize editing state for the selected role
    const role = roles.find(r => r.id === roleId)
    if (role) {
      const colorHex = `#${role.color.toString(16).padStart(6, '0')}`
      setEditingRoleId(roleId)
      setEditingRoleName(role.name)
      setEditingRoleColor(colorHex)
      setEditingRolePermissions(role.permissions)
      // Store original values for change detection and cancel
      setOriginalRoleName(role.name)
      setOriginalRoleColor(colorHex)
      setOriginalRolePermissions(role.permissions)
    }
  }

  const handleDeleteRole = async (roleId: string) => {
    try {
      await api.deleteRole(roleId)
      setRoles(prev => {
        const newRoles = prev.filter(r => r.id !== roleId)
        // Select another role if the deleted one was selected (first in display order)
        if (selectedRoleId === roleId && newRoles.length > 0) {
          const newSelectedRole = sortRolesByPosition(newRoles)[0]
          setSelectedRoleId(newSelectedRole.id)
          // Initialize editing state for the new selected role
          const colorHex = `#${newSelectedRole.color.toString(16).padStart(6, '0')}`
          setEditingRoleId(newSelectedRole.id)
          setEditingRoleName(newSelectedRole.name)
          setEditingRoleColor(colorHex)
          setEditingRolePermissions(newSelectedRole.permissions)
          setOriginalRoleName(newSelectedRole.name)
          setOriginalRoleColor(colorHex)
          setOriginalRolePermissions(newSelectedRole.permissions)
        }
        return newRoles
      })
      setMembers(prev => prev.map(m => ({
        ...m,
        role_ids: (m.role_ids ?? []).filter((id: string) => id !== roleId)
      })))
    } catch (e) { console.warn('Failed to delete role:', e) }
  }

  const handleSaveRoleInfo = async () => {
    if (!editingRoleId || !editingRoleName.trim()) return
    try {
      const updated = await api.updateRole(editingRoleId, {
        name: editingRoleName.trim(),
        color: parseInt(editingRoleColor.replace('#', ''), 16),
        permissions: editingRolePermissions,
      })
      setRoles(prev => prev.map(r => r.id === editingRoleId ? updated : r))
      // Update original values after successful save
      setOriginalRoleName(editingRoleName.trim())
      setOriginalRoleColor(editingRoleColor)
      setOriginalRolePermissions(editingRolePermissions)
    } catch (e) { console.warn('Failed to update role:', e) }
  }

  const handleCancelEditRoleInfo = () => {
    // Revert to original values instead of closing
    setEditingRoleName(originalRoleName)
    setEditingRoleColor(originalRoleColor)
    setEditingRolePermissions(originalRolePermissions)
  }

  // Check if there are any unsaved changes
  const hasRoleChanges = editingRoleId && (
    editingRoleName !== originalRoleName ||
    editingRoleColor !== originalRoleColor ||
    editingRolePermissions !== originalRolePermissions
  )

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
            {section === 'roles' && (
              <div className={s.sectionFull}>
                <div className={s.rolesLayout}>
                  {/* Left: Role List */}
                  <div className={s.rolesLeftPanel}>
                    <span className={`${s.rolesListHeader} txt-tiny txt-semibold`}>All Roles</span>
                    <div className={`${s.rolesList} scrollbar-thin`}>
                      {rolesOrdered.map(role => (
                        <button
                          key={role.id}
                          className={`${s.roleItem} ${selectedRoleId === role.id ? s.roleItemSelected : ''}`}
                          onClick={() => handleSelectRole(role.id)}
                        >
                          <div
                            className={s.roleColorDot}
                            style={{ background: `#${role.color.toString(16).padStart(6, '0')}` }}
                          />
                          <span className={`${s.roleName} txt-small`}>{role.name}</span>
                        </button>
                      ))}
                    </div>

                    {/* Create Role Button */}
                    <button
                      className={s.createRoleBtn}
                      onClick={handleCreateRole}
                    >
                      <Plus size={14} strokeWidth={1.5} />
                      <span>Create Role</span>
                    </button>
                  </div>

                  {/* Right: Role Editor */}
                  <div className={s.rolesRightPanel}>
                    {selectedRoleId && (() => {
                      const role = roles.find(r => r.id === selectedRoleId)
                      if (!role) return null
                      const isRoleSelected = editingRoleId === role.id
                      const currentPermissions = editingRolePermissions

                      return (
                        <>
                          {/* Role Info Header */}
                          <div className={s.roleInfoHeader}>
                            <div className={s.roleInfoTitle}>
                              <div className={s.roleInfoEditRow}>
                                <input
                                  type="color"
                                  value={editingRoleColor}
                                  onChange={e => setEditingRoleColor(e.target.value)}
                                  className={s.colorPickerInline}
                                />
                                <input
                                  type="text"
                                  value={editingRoleName}
                                  onChange={e => setEditingRoleName(e.target.value)}
                                  className={s.roleNameInput}
                                  maxLength={32}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleSaveRoleInfo()
                                    if (e.key === 'Escape') handleCancelEditRoleInfo()
                                  }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Permissions Section */}
                          <div className={s.permissionsSection}>
                            <div className={s.permissionsSectionHeader}>
                              <h4 className={`${s.permissionsSectionTitle} txt-small txt-semibold`}>Permissions</h4>
                              <button
                                className={s.clearPermsBtn}
                                onClick={() => setEditingRolePermissions(0)}
                              >
                                Clear permissions
                              </button>
                            </div>
                            <div className={`${s.permissionsList} scrollbar-thin scroll-view-y`}>
                              <PermissionGroup
                                title="General Server Permissions"
                                permissions={[
                                  { flag: P.VIEW_CHANNELS, label: 'View Channels', description: 'Allows members to view channels by default (excluding private channels).' },
                                  { flag: P.MANAGE_CHANNELS, label: 'Manage Channels', description: 'Allows members to create, edit, or delete channels.' },
                                  { flag: P.MANAGE_SERVER, label: 'Manage Server', description: 'Allows members to change server name, icon, and other settings.' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isRoleSelected}
                                onToggle={handlePermissionToggle}
                              />

                              <PermissionGroup
                                title="Member Permissions"
                                permissions={[
                                  { flag: P.KICK_MEMBERS, label: 'Kick Members', description: 'Allows members to kick other members from the server.' },
                                  { flag: P.BAN_MEMBERS, label: 'Ban Members', description: 'Allows members to ban other members from the server.' },
                                  { flag: P.MANAGE_ROLES, label: 'Manage Roles', description: 'Allows members to create new roles and edit or delete roles lower than their highest role.' },
                                  { flag: P.CREATE_INVITE, label: 'Create Invites', description: 'Allows members to create invite links to the server.' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isRoleSelected}
                                onToggle={handlePermissionToggle}
                              />

                              <PermissionGroup
                                title="Text Channel Permissions"
                                permissions={[
                                  { flag: P.SEND_MESSAGES, label: 'Send Messages', description: 'Allows members to send messages in text channels.' },
                                  { flag: P.MANAGE_MESSAGES, label: 'Manage Messages', description: 'Allows members to delete and pin messages in text channels.' },
                                  { flag: P.EMBED_LINKS, label: 'Embed Links', description: 'Allows members to embed links in messages.' },
                                  { flag: P.ATTACH_FILES, label: 'Attach Files', description: 'Allows members to attach files to messages.' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isRoleSelected}
                                onToggle={handlePermissionToggle}
                              />

                              <PermissionGroup
                                title="Voice Channel Permissions"
                                permissions={[
                                  { flag: P.CONNECT, label: 'Connect', description: 'Allows members to connect to voice channels.' },
                                  { flag: P.SPEAK, label: 'Speak', description: 'Allows members to speak in voice channels.' },
                                  { flag: P.VIDEO, label: 'Video', description: 'Allows members to share video in voice channels.' },
                                  { flag: P.MUTE_MEMBERS, label: 'Mute Members', description: 'Allows members to mute other members in voice channels.' },
                                  { flag: P.DEAFEN_MEMBERS, label: 'Deafen Members', description: 'Allows members to deafen other members in voice channels.' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isRoleSelected}
                                onToggle={handlePermissionToggle}
                              />

                              <div className={s.permissionItem}>
                                <div className={s.permissionInfo}>
                                  <span className={`${s.permissionLabel} txt-small txt-medium`}>Administrator</span>
                                  <span className={`${s.permissionDesc} txt-tiny`}>Grants all permissions and bypasses channel permissions. This is a dangerous permission!</span>
                                </div>
                                <div className={s.permToggleGroup}>
                                  <button
                                    className={`${s.permToggleBtn} ${(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? s.permToggleBtnActive : ''}`}
                                    onClick={isRoleSelected ? () => handlePermissionToggle(P.ADMINISTRATOR) : undefined}
                                    disabled={!isRoleSelected}
                                    aria-label={(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? 'Disable Administrator' : 'Enable Administrator'}
                                  >
                                    <Check size={16} strokeWidth={2.5} />
                                  </button>
                                  <button
                                    className={`${s.permToggleBtn} ${(currentPermissions & P.ADMINISTRATOR) !== P.ADMINISTRATOR ? s.permToggleBtnDeny : ''}`}
                                    onClick={isRoleSelected ? () => handlePermissionToggle(P.ADMINISTRATOR) : undefined}
                                    disabled={!isRoleSelected}
                                    aria-label={(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? 'Disable Administrator' : 'Enable Administrator'}
                                  >
                                    <X size={16} strokeWidth={2.5} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Footer: Delete + Cancel/Save */}
                          <div className={s.roleFooter}>
                            <div className={s.roleFooterLeft}>
                              {!role.is_default && (
                                <button
                                  className={s.deleteRoleLink}
                                  onClick={() => handleDeleteRole(role.id)}
                                >
                                  <Trash2 size={14} strokeWidth={1.5} />
                                  <span>Delete Role</span>
                                </button>
                              )}
                            </div>
                            <div className={s.roleFooterRight}>
                              <button
                                className={s.cancelBtn}
                                onClick={handleCancelEditRoleInfo}
                              >
                                Cancel
                              </button>
                              <button
                                className={s.saveBtn}
                                onClick={handleSaveRoleInfo}
                                disabled={!hasRoleChanges}
                              >
                                <Save size={14} strokeWidth={1.5} />
                                <span>Save</span>
                              </button>
                            </div>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>
              </div>
            )}

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


// Permission Group Component
interface PermissionDef {
  flag: number
  label: string
  description: string
}

function PermissionGroup({
  title,
  permissions,
  currentPermissions,
  isEditing,
  onToggle
}: {
  title: string
  permissions: PermissionDef[]
  currentPermissions: number
  isEditing: boolean
  onToggle: (flag: number) => void
}) {
  return (
    <div className={s.permissionGroup}>
      <h5 className={`${s.permissionGroupTitle} txt-tiny txt-semibold`}>{title}</h5>
      {permissions.map(perm => {
        const isGranted = (currentPermissions & perm.flag) === perm.flag
        return (
          <div key={perm.flag} className={s.permissionItem}>
            <div className={s.permissionInfo}>
              <span className={`${s.permissionLabel} txt-small txt-medium`}>{perm.label}</span>
              <span className={`${s.permissionDesc} txt-tiny`}>{perm.description}</span>
            </div>
            <div className={s.permToggleGroup}>
              <button
                className={`${s.permToggleBtn} ${isGranted ? s.permToggleBtnActive : ''}`}
                onClick={isEditing ? () => onToggle(perm.flag) : undefined}
                disabled={!isEditing}
                aria-label={isGranted ? `Disable ${perm.label}` : `Enable ${perm.label}`}
              >
                <Check size={16} strokeWidth={2.5} />
              </button>
              <button
                className={`${s.permToggleBtn} ${!isGranted ? s.permToggleBtnDeny : ''}`}
                onClick={isEditing ? () => onToggle(perm.flag) : undefined}
                disabled={!isEditing}
                aria-label={isGranted ? `Disable ${perm.label}` : `Enable ${perm.label}`}
              >
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
