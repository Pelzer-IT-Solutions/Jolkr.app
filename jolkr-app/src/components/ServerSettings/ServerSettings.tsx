import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Info, Users, Shield, Link2, ScrollText, Trash2, Save, ChevronRight, Plus, Check, Camera
} from 'lucide-react'
import type { Invite, Role, Ban, AuditLogEntry } from '../../api/types'
import type { Server as ApiServer, Member } from '../../api/types'
import * as api from '../../api/client'
import * as P from '../../utils/permissions'
import { useAuthStore } from '../../stores/auth'
import ServerIcon from '../ServerIcon'

// Extend API Server with frontend-only display fields
type Server = ApiServer & { hue?: number | null; discoverable?: boolean }
import { revealDelay } from '../../utils/animations'
import { useRevealAnimation } from '../../hooks/useRevealAnimation'
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
  const [iconUploading, setIconUploading] = useState(false)
  const [iconPreviewUrl, setIconPreviewUrl] = useState<string | null>(null)
  const iconFileRef = useRef<HTMLInputElement>(null)

  // TODO: Replace with real API data
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

  const navTotal = NAV.reduce((sum, g) => sum + 1 + g.items.length, 0)
  const isRevealing = useRevealAnimation(navTotal, [navTotal])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Load real data from API
  useEffect(() => {
    const id = server.id
    api.getRoles(id).then((loadedRoles) => {
      setRoles(loadedRoles)
      // Always auto-select first role when roles are loaded
      if (loadedRoles.length > 0) {
        const firstRole = loadedRoles[0]
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

  const handleFieldChange = (field: keyof Server, value: unknown) => {
    setEditedServer(prev => ({ ...prev, [field]: value }))
    setHasChanges(true)
  }

  const handleSave = () => {
    onUpdate(server.id, editedServer)
    setHasChanges(false)
    setEditedServer({})
  }

  const handleCreateInvite = () => {
    const newInvite: Invite = {
      id: `inv-${Date.now()}`,
      server_id: server.id,
      creator_id: 'me',
      code: Math.random().toString(36).substring(2, 10).toUpperCase(),
      max_uses: null,
      use_count: 0,
      expires_at: null,
    }
    setInvites(prev => [newInvite, ...prev])
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
        // Select another role if the deleted one was selected
        if (selectedRoleId === roleId && newRoles.length > 0) {
          const newSelectedRole = newRoles[0]
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
    setIconUploading(true)
    try {
      const result = await api.uploadFile(file, 'icon')
      handleFieldChange('icon_url', result.key)
      setIconPreviewUrl(URL.createObjectURL(file))
    } catch { /* ignore */ }
    setIconUploading(false)
  }

  const currentName = editedServer.name ?? server.name
  const currentDescription = editedServer.description ?? server.description ?? ''
  const currentBannerUrl = editedServer.banner_url ?? server.banner_url ?? ''
  const currentDiscoverable = editedServer.discoverable ?? server.discoverable ?? false

  let navIdx = 0

  return createPortal(
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>
        {/* Left nav */}
        <aside className={s.nav}>
          <div className={`${s.navScroll} scrollbar-thin`}>
            <div className={s.serverHeader}>
              <ServerIcon name={server.name} iconUrl={server.icon_url} serverId={server.id} size="sm" />
              <span className={`${s.serverName} txt-small txt-semibold`}>{server.name}</span>
            </div>
            <div className={s.navDivider} />
            {NAV.map(group => {
              const groupIdx = navIdx++
              return (
              <div key={group.group} className={s.navGroup}>
                <span
                  className={`${s.navGroupLabel} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}
                  style={isRevealing ? { '--reveal-delay': `${revealDelay(groupIdx)}ms` } as React.CSSProperties : undefined}
                >
                  {group.group}
                </span>
                {group.items.map(item => {
                  const itemIdx = navIdx++
                  return (
                  <button
                    key={item.id}
                    className={`${s.navItem} ${section === item.id ? s.navItemActive : ''} ${isRevealing ? 'revealing' : ''} ${item.id === 'delete' ? s.navItemDanger : ''}`}
                    style={isRevealing ? { '--reveal-delay': `${revealDelay(itemIdx)}ms` } as React.CSSProperties : undefined}
                    onClick={() => setSection(item.id)}
                  >
                    <span className={s.navIcon}>{item.icon}</span>
                    <span className={`${s.navLabel} txt-small txt-medium`}>{item.label}</span>
                    {section === item.id && <ChevronRight size={12} strokeWidth={2} className={s.navChevron} />}
                  </button>
                  )
                })}
              </div>
              )
            })}
          </div>

          {/* Leave Server Button (hidden for owner — must transfer or delete) */}
          {!isOwner && (
            <div className={s.navFooter}>
              <button className={s.leaveBtn} onClick={() => setShowLeaveConfirm(true)}>
                <Users size={14} strokeWidth={1.5} />
                <span className="txt-small">Leave Server</span>
              </button>
            </div>
          )}
        </aside>

        {/* Right content */}
        <main className={s.content}>
          {/* Header */}
          <div className={s.header}>
            <div className={s.headerTitleRow}>
              <h2 className={`${s.title} txt-title`}>
                {NAV.flatMap(g => g.items).find(i => i.id === section)?.label}
              </h2>
              {section === 'roles' && (
                <span className={s.rolesCount}>{roles.length}</span>
              )}
            </div>
            <button className={s.closeBtn} onClick={onClose}>
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>

          <div className={`${s.scroll} ${section === 'roles' ? s.scrollNoPadding : ''} scrollbar-thin`}>
            {/* Overview Section */}
            {section === 'overview' && (
              <div className={s.section}>
                <div className={s.fieldGroup}>
                  <label className={`${s.label} txt-tiny txt-semibold`}>Server Name</label>
                  <input
                    type="text"
                    className={`${s.input} txt-small`}
                    value={currentName}
                    onChange={e => handleFieldChange('name', e.target.value)}
                    maxLength={100}
                  />
                </div>

                <div className={s.fieldGroup}>
                  <label className={`${s.label} txt-tiny txt-semibold`}>Description</label>
                  <textarea
                    className={`${s.textarea} txt-small`}
                    value={currentDescription}
                    onChange={e => handleFieldChange('description', e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="What's your server about?"
                  />
                </div>

                <div className={s.fieldGroup}>
                  <label className={`${s.label} txt-tiny txt-semibold`}>Server Icon</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      className="group"
                      style={{ position: 'relative', cursor: 'pointer', borderRadius: '50%', overflow: 'hidden', width: 64, height: 64, flexShrink: 0 }}
                      onClick={() => iconFileRef.current?.click()}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); iconFileRef.current?.click() }}}
                    >
                      {iconPreviewUrl ? (
                        <img src={iconPreviewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <ServerIcon name={currentName} iconUrl={server.icon_url} serverId={server.id} size="lg" />
                      )}
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        {iconUploading ? <span style={{ color: '#fff', fontSize: 11 }}>...</span> : <Camera size={20} color="#aaa" />}
                      </div>
                    </div>
                    <span className="txt-tiny" style={{ color: 'var(--text-tertiary)' }}>Click to upload<br />Recommended: 128x128</span>
                    <input ref={iconFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleIconUpload} />
                  </div>
                </div>

                <div className={s.fieldGroup}>
                  <label className={`${s.label} txt-tiny txt-semibold`}>Banner URL</label>
                  <input
                    type="text"
                    className={`${s.input} txt-small`}
                    value={currentBannerUrl}
                    onChange={e => handleFieldChange('banner_url', e.target.value)}
                    placeholder="https://..."
                  />
                </div>

                <div className={s.fieldGroup}>
                  <label className={s.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={currentDiscoverable}
                      onChange={e => handleFieldChange('discoverable', e.target.checked)}
                    />
                    <span className="txt-small">Make server discoverable in server browser</span>
                  </label>
                </div>

                {hasChanges && (
                  <div className={s.actions}>
                    <button className={s.saveBtn} onClick={handleSave}>
                      <Save size={14} strokeWidth={1.5} />
                      <span className="txt-small">Save Changes</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Roles Section */}
            {section === 'roles' && (
              <div className={s.sectionFull}>
                <div className={s.rolesLayout}>
                  {/* Left: Role List */}
                  <div className={s.rolesLeftPanel}>
                    <div className={`${s.rolesList} scrollbar-thin`}>
                      {roles.map(role => (
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
                <div className={s.sectionHeader}>
                  <h3 className="txt-small txt-semibold">Active Invites</h3>
                  <button className={s.createBtn} onClick={handleCreateInvite}>Create Invite</button>
                </div>
                {invites.length === 0 ? (
                  <p className={`${s.empty} txt-small`}>No active invites. Create one to invite people!</p>
                ) : (
                  <div className={s.invitesList}>
                    {invites.map(invite => (
                      <div key={invite.id} className={s.inviteItem}>
                        <div className={s.inviteInfo}>
                          <code className={s.inviteCode}>{invite.code}</code>
                          <span className={`${s.inviteMeta} txt-tiny`}>
                            {invite.use_count} / {invite.max_uses ?? '\u221E'} uses
                            {invite.expires_at && ` \u00B7 Expires ${new Date(invite.expires_at).toLocaleDateString()}`}
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
                )}
              </div>
            )}

            {/* Bans Section */}
            {section === 'bans' && (
              <div className={s.section}>
                <div className={s.sectionHeader}>
                  <h3 className="txt-small txt-semibold">Banned Users ({bans.length})</h3>
                </div>
                {bans.length === 0 ? (
                  <p className={`${s.empty} txt-small`}>No banned users. Bans will appear here.</p>
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
                <div className={s.sectionHeader}>
                  <h3 className="txt-small txt-semibold">Audit Log ({auditLog.length} entries)</h3>
                </div>
                {auditLog.length === 0 ? (
                  <p className={`${s.empty} txt-small`}>No audit log entries yet.</p>
                ) : (
                  <div className={s.auditList}>
                    {auditLog.map(entry => (
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
          </div>
        </main>

        {/* Leave Confirmation Modal */}
        {showLeaveConfirm && (
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
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
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
          </div>
        )}
      </div>
    </div>,
    document.body
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
