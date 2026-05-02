import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Info, Users, Shield, Link2, ScrollText, Trash2, Save, Plus, Check, Camera, Palette, Upload, Copy
} from 'lucide-react'
import type { Invite, Role, Ban, AuditLogEntry } from '../../api/types'
import type { Server as ApiServer, Member } from '../../api/types'
import * as api from '../../api/client'
import * as P from '../../utils/permissions'
import { useAuthStore } from '../../stores/auth'
import { buildInviteUrl } from '../../platform/config'
import { useToast } from '../Toast'
import ServerIcon from '../ServerIcon/ServerIcon'
import { SettingsShell, type SettingsNavGroup } from '../SettingsShell'

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
  const [createInviteMaxAge, setCreateInviteMaxAge] = useState<number>(86400) // 1 day default
  const [createInviteMaxUses, setCreateInviteMaxUses] = useState<number>(0) // 0 = unlimited
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [createInviteError, setCreateInviteError] = useState('')
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const showToast = useToast(s => s.show)
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

  const handleCreateInvite = async () => {
    setCreatingInvite(true)
    setCreateInviteError('')
    try {
      const body: { max_uses?: number; max_age_seconds?: number } = {}
      if (createInviteMaxUses > 0) body.max_uses = createInviteMaxUses
      if (createInviteMaxAge > 0) body.max_age_seconds = createInviteMaxAge
      const created = await api.createInvite(server.id, Object.keys(body).length > 0 ? body : undefined)
      setInvites(prev => [created, ...prev])
    } catch (e) {
      setCreateInviteError((e as Error).message || 'Failed to create invite')
    } finally {
      setCreatingInvite(false)
    }
  }

  const handleCopyInvite = async (invite: Invite) => {
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

  const handleDeleteInvite = async (inviteId: string) => {
    try {
      await api.deleteInvite(server.id, inviteId)
      setInvites(prev => prev.filter(inv => inv.id !== inviteId))
    } catch (e) { console.warn('Failed to delete invite:', e) }
  }

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
              <OverviewSection
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
              <div className={s.section}>
                <div className={s.inviteCreateRow}>
                  <div className={s.inviteCreateField}>
                    <label className={`${s.inviteCreateLabel} txt-tiny txt-semibold`}>Expire after</label>
                    <select
                      className={s.inviteSelect}
                      style={{ maxHeight: '32px' }}
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
                    </select>
                  </div>
                  <div className={s.inviteCreateField}>
                    <label className={`${s.inviteCreateLabel} txt-tiny txt-semibold`}>Max uses</label>
                    <select
                      className={s.inviteSelect}
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
                    </select>
                  </div>
                  <button
                    className={`${s.createBtn} ${s.inviteRowBtn}`}
                    onClick={handleCreateInvite}
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
                              onClick={() => handleCopyInvite(invite)}
                              title="Click to copy invite link"
                            >
                              <code className={s.inviteCode}>{invite.code}</code>
                              {copiedInviteId === invite.id
                                ? <Check size={13} strokeWidth={1.75} />
                                : <Copy size={13} strokeWidth={1.5} />}
                            </button>
                            <span className={`${s.inviteMeta} txt-tiny`}>
                              {invite.use_count} / {invite.max_uses ?? '\u221E'} uses
                              {invite.expires_at && ` \u00B7 Expires ${new Date(invite.expires_at).toLocaleString()}`}
                            </span>
                          </div>
                          <button
                            className={s.revokeBtn}
                            onClick={() => handleDeleteInvite(invite.id)}
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Bans Section */}
            {section === 'bans' && (
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
                          <div className={s.banAvatar}>
                            ?
                          </div>
                          <div className={s.banDetails}>
                            <span className={`${s.banName} txt-small txt-medium`}>
                              {ban.user_id}
                            </span>
                            <span className={s.banMeta}>
                              {ban.reason ? `Reason: ${ban.reason}` : 'No reason provided'}
                              {' \u00B7 '}
                              Banned {new Date(ban.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          className={s.unbanBtn}
                          onClick={() => handleUnban(ban.id)}
                        >
                          Unban
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Audit Log Section */}
            {section === 'audit' && (
              <div className={s.section}>
                {auditLog.length === 0 ? (
                  <div className={s.emptyState}>
                    <div className={s.emptyStateIcon}>
                      <ScrollText size={32} strokeWidth={1.5} />
                    </div>
                    <span className={`${s.emptyStateTitle} txt-small txt-medium`}>No Activity Yet</span>
                    <span className={`${s.emptyStateDesc} txt-small`}>Audit log entries will appear here when server actions are performed.</span>
                  </div>
                ) : (
                  <div className={s.auditList}>
                    {(() => {
                      // Group entries by day
                      const grouped = auditLog.reduce((acc, entry) => {
                        const date = new Date(entry.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                        if (!acc[date]) acc[date] = []
                        acc[date].push(entry)
                        return acc
                      }, {} as Record<string, typeof auditLog>)

                      return Object.entries(grouped).map(([date, entries]) => (
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
                      ))
                    })()}
                  </div>
                )}
              </div>
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

// Overview — solid colors match Settings.tsx AccountSection (BANNER_COLORS)
const BANNER_COLORS = [
  { name: 'Sage', value: 'oklch(60% 0.1 136)' },
  { name: 'Gold', value: 'oklch(65% 0.12 85)' },
  { name: 'Ocean', value: 'oklch(60% 0.12 215)' },
  { name: 'Royal', value: 'oklch(55% 0.18 280)' },
  { name: 'Berry', value: 'oklch(55% 0.18 340)' },
  { name: 'Coral', value: 'oklch(60% 0.15 25)' },
]

function hueFromOklch(oklch: string): number | null {
  const m = oklch.match(/oklch\([^\s]+\s+[^\s]+\s+(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

const BANNER_PRESETS = {
  gradients: [
    { name: 'Ocean Breeze', value: 'linear-gradient(135deg, oklch(60% 0.12 215), oklch(55% 0.1 180))' },
    { name: 'Sunset Glow', value: 'linear-gradient(135deg, oklch(65% 0.15 45), oklch(55% 0.18 340))' },
    { name: 'Forest Mist', value: 'linear-gradient(135deg, oklch(60% 0.1 136), oklch(55% 0.08 160))' },
    { name: 'Royal Velvet', value: 'linear-gradient(135deg, oklch(55% 0.18 280), oklch(50% 0.15 320))' },
    { name: 'Berry Burst', value: 'linear-gradient(135deg, oklch(55% 0.18 340), oklch(60% 0.12 25))' },
    { name: 'Midnight', value: 'linear-gradient(135deg, oklch(40% 0.05 250), oklch(35% 0.08 280))' },
  ],
}

interface OverviewSectionProps {
  server: Server
  editedServer: Partial<Server>
  setEditedServer: Dispatch<SetStateAction<Partial<Server>>>
  hasChanges: boolean
  setHasChanges: (has: boolean) => void
  iconPreviewUrl: string | null
  setIconPreviewUrl: (url: string | null) => void
  iconFileRef: React.RefObject<HTMLInputElement | null>
  onUpdate: (serverId: string, data: Partial<Server>) => void
  onIconUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
}

function OverviewSection({
  server,
  editedServer,
  setEditedServer,
  hasChanges,
  setHasChanges,
  iconPreviewUrl,
  iconFileRef,
  onUpdate,
  onIconUpload,
}: OverviewSectionProps) {
  const [showBannerMenu, setShowBannerMenu] = useState(false)
  const [bannerPopoverPos, setBannerPopoverPos] = useState({ top: 0, left: 0 })
  const [bannerUploading, setBannerUploading] = useState(false)
  const bannerMenuBtnRef = useRef<HTMLButtonElement>(null)
  const bannerPopoverRef = useRef<HTMLDivElement>(null)
  const bannerFileInputRef = useRef<HTMLInputElement>(null)
  // Store banner gradient in local state since it's not in Server type
  const [bannerGradient, setBannerGradient] = useState<string | null>(null)

  // Compute current values (edited or original)
  const currentName = editedServer.name ?? server.name
  const currentDescription = editedServer.description ?? server.description ?? ''
  const currentBannerUrl = editedServer.banner_url ?? server.banner_url ?? ''
  const currentDiscoverable = editedServer.discoverable ?? server.discoverable ?? false
  const currentHue =
    editedServer.hue ?? server.hue ?? server.theme?.hue ?? null
  const currentGradient = bannerGradient

  const updateBannerPopoverPosition = useCallback(() => {
    const btn = bannerMenuBtnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const panelWidth = 320
    const left = Math.max(8, Math.min(r.left, window.innerWidth - panelWidth - 8))
    setBannerPopoverPos({ top: r.bottom + 8, left })
  }, [])

  useLayoutEffect(() => {
    if (!showBannerMenu) return
    updateBannerPopoverPosition()
    const onScrollOrResize = () => updateBannerPopoverPosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [showBannerMenu, updateBannerPopoverPosition])

  useEffect(() => {
    if (!showBannerMenu) return
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (bannerPopoverRef.current?.contains(t)) return
      if (bannerMenuBtnRef.current?.contains(t)) return
      setShowBannerMenu(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [showBannerMenu])

  // Solid fill: use exact preset string when hue matches Settings palette (same as profile banner)
  const getBannerBackground = () => {
    if (currentBannerUrl) return `url(${currentBannerUrl}) center/cover`
    if (currentGradient) return currentGradient
    if (currentHue != null) {
      const preset = BANNER_COLORS.find(c => hueFromOklch(c.value) === currentHue)
      if (preset) return preset.value
      return `oklch(60% 0.12 ${currentHue})`
    }
    return BANNER_COLORS[2].value
  }

  const isSolidColorActive = (presetValue: string) => {
    if (currentBannerUrl || currentGradient || currentHue == null) return false
    return hueFromOklch(presetValue) === currentHue
  }

  const handleFieldChange = (field: keyof Server, value: unknown) => {
    // Functional update so sequential calls (e.g. hue + banner_url) don't clobber each other
    setEditedServer(prev => ({ ...prev, [field]: value }))
    setHasChanges(true)
  }

  const handleSave = () => {
    onUpdate(server.id, editedServer)
    setHasChanges(false)
    setEditedServer({})
  }

  const handleBannerColorSelect = (colorValue: string) => {
    const h = hueFromOklch(colorValue)
    if (h != null) {
      handleFieldChange('hue', h)
      setBannerGradient(null)
      handleFieldChange('banner_url', null)
    }
  }

  const handleGradientSelect = (gradientValue: string) => {
    setBannerGradient(gradientValue)
    handleFieldChange('hue', null)
    handleFieldChange('banner_url', null)
    setHasChanges(true)
  }

  const handleImageUrlChange = (url: string) => {
    handleFieldChange('banner_url', url)
    handleFieldChange('hue', null)
    setBannerGradient(null)
  }

  const handleBannerFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBannerUploading(true)
    try {
      const result = await api.uploadFile(file)
      const url = result.url ?? result.key
      handleImageUrlChange(url)
    } catch {
      /* ignore */
    } finally {
      setBannerUploading(false)
    }
  }

  return (
    <div className={s.section}>
      {/* Server Preview Card - Visual Editor */}
      <div className={s.serverPreviewCard}>
        <div className={s.bannerEditorWrap}>
          <div className={s.bannerEditor} style={{ background: getBannerBackground() }} />
          <div className={s.serverPreviewActions}>
            <button
              ref={bannerMenuBtnRef}
              type="button"
              className={`${s.colorPickerBtn} ${showBannerMenu ? s.colorPickerActive : ''}`}
              onClick={() => setShowBannerMenu(v => !v)}
              title="Banner background"
              aria-expanded={showBannerMenu}
              aria-haspopup="dialog"
            >
              <Palette size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {showBannerMenu &&
          createPortal(
            <div
              ref={bannerPopoverRef}
              className={s.bannerPopover}
              style={{ top: bannerPopoverPos.top, left: bannerPopoverPos.left }}
              role="dialog"
              aria-label="Banner background"
            >
              <div className={s.bannerPopoverSection}>
                <span className={`${s.bannerPopoverLabel} txt-tiny txt-semibold`}>Solid colors</span>
                <div className={s.bannerPopoverSwatches}>
                  {BANNER_COLORS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`${s.colorPickerSwatch} ${isSolidColorActive(c.value) ? s.colorPickerSwatchActive : ''}`}
                      style={{ background: c.value }}
                      onClick={() => handleBannerColorSelect(c.value)}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>

              <div className={s.bannerPopoverSection}>
                <span className={`${s.bannerPopoverLabel} txt-tiny txt-semibold`}>Gradients</span>
                <div className={s.bannerPopoverSwatches}>
                  {BANNER_PRESETS.gradients.map(g => (
                    <button
                      key={g.name}
                      type="button"
                      className={`${s.colorPickerSwatch} ${currentGradient === g.value ? s.colorPickerSwatchActive : ''}`}
                      style={{ background: g.value }}
                      onClick={() => handleGradientSelect(g.value)}
                      title={g.name}
                    />
                  ))}
                </div>
              </div>

              <div className={s.bannerPopoverSection}>
                <span className={`${s.bannerPopoverLabel} txt-tiny txt-semibold`}>Image</span>
                <div className={s.bannerPopoverImageRow}>
                  <input
                    type="text"
                    className={s.bannerPopoverUrlInput}
                    value={currentBannerUrl}
                    onChange={e => handleImageUrlChange(e.target.value)}
                    placeholder="Image URL (https://…)"
                    autoComplete="off"
                  />
                  <input
                    ref={bannerFileInputRef}
                    type="file"
                    accept="image/*"
                    className={s.bannerPopoverFileInput}
                    onChange={handleBannerFileChange}
                  />
                  <button
                    type="button"
                    className={s.bannerPopoverUploadBtn}
                    disabled={bannerUploading}
                    onClick={() => bannerFileInputRef.current?.click()}
                  >
                    <Upload size={14} strokeWidth={1.5} />
                    {bannerUploading ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
                {currentBannerUrl ? (
                  <button
                    type="button"
                    className={s.bannerPopoverClearImage}
                    onClick={() => handleImageUrlChange('')}
                  >
                    Remove image banner
                  </button>
                ) : null}
              </div>
            </div>,
            document.body
          )}

        {/* Server Content */}
        <div className={s.previewContent}>
          {/* Server Icon with Upload */}
          <div
            className={s.previewAvatarWrap}
            onClick={() => iconFileRef.current?.click()}
          >
            <input
              ref={iconFileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onIconUpload}
            />
            <div className={s.previewAvatar}>
              {iconPreviewUrl ? (
                <img src={iconPreviewUrl} alt="Server Icon" className={s.previewAvatarImg} />
              ) : (
                <ServerIcon name={currentName} iconUrl={server.icon_url} serverId={server.id} size="lg" />
              )}
            </div>
            <div className={s.avatarChangeOverlay}>
              <Camera size={20} strokeWidth={1.5} />
            </div>
          </div>

          {/* Direct Edit Fields */}
          <div className={s.previewInfo}>
            <input
              type="text"
              className={s.inlineNameInput}
              value={currentName}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              placeholder="Server Name"
              maxLength={100}
            />
            <textarea
              className={s.inlineDescInput}
              value={currentDescription}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              placeholder="What's your server about?"
              rows={2}
              maxLength={500}
            />
          </div>
        </div>
      </div>

      {/* Discoverable Toggle */}
      <div className={s.simpleFieldRow}>
        <div className={s.toggleMeta}>
          <span className={`${s.toggleLabel} txt-small txt-medium`}>Server Discovery</span>
          <span className={`${s.toggleDesc} txt-tiny`}>Make server discoverable in server browser</span>
        </div>
        <button
          className={`${s.toggle} ${currentDiscoverable ? s.toggleOn : ''}`}
          onClick={() => handleFieldChange('discoverable', !currentDiscoverable)}
          role="switch"
          aria-checked={currentDiscoverable}
        >
          <span className={s.toggleThumb} />
        </button>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className={s.saveActions}>
          <button className={s.saveChangesBtn} onClick={handleSave}>
            <Save size={14} strokeWidth={1.5} />
            Save Changes
          </button>
        </div>
      )}
    </div>
  )
}

// Helper functions for Audit Log
function AuditIcon({ actionType }: { actionType: string }) {
  const iconMap: Record<string, string> = {
    'MemberJoin': '\uD83D\uDC64',
    'MemberLeave': '\uD83D\uDC4B',
    'MemberUpdate': '\u270F\uFE0F',
    'ChannelCreate': '\uD83D\uDCDD',
    'ChannelUpdate': '\uD83D\uDCCB',
    'ChannelDelete': '\uD83D\uDDD1\uFE0F',
    'RoleCreate': '\uD83D\uDEE1\uFE0F',
    'RoleUpdate': '\u2699\uFE0F',
    'RoleDelete': '\u274C',
    'ServerUpdate': '\uD83D\uDD27',
    'ServerDelete': '\uD83D\uDCA5',
    'BanCreate': '\uD83D\uDD28',
    'BanDelete': '\uD83D\uDD13',
    'Kick': '\uD83D\uDC62',
  }
  return <span className={s.auditIconInner}>{iconMap[actionType] || '\uD83D\uDCCC'}</span>
}

function formatActionType(actionType: string): string {
  const formatMap: Record<string, string> = {
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
  return formatMap[actionType] || actionType.replace(/([A-Z])/g, ' $1').trim()
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
