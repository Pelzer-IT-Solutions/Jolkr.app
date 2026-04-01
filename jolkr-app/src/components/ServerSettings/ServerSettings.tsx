import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Info, Users, Shield, Link2, ScrollText, Trash2, Save, ChevronRight, Plus, Edit2, Check, XCircle
} from 'lucide-react'
import type { Invite, Role, Ban, AuditLogEntry } from '../../api/types'
import type { Server as ApiServer, Member } from '../../api/types'
import * as P from '../../utils/permissions'
import { useAuthStore } from '../../stores/auth'

// Extend API Server with frontend-only display fields
type Server = ApiServer & { hue?: number | null; discoverable?: boolean }
import { revealDelay, revealWindowMs } from '../../utils/animations'
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
  const [isRevealing, setIsRevealing] = useState(true)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
  const [showCreateRole, setShowCreateRole] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleColor, setNewRoleColor] = useState('#5865F2')
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)

  const navTotal = NAV.reduce((sum, g) => sum + 1 + g.items.length, 0)

  useEffect(() => {
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(navTotal))
    return () => clearTimeout(timer)
  }, [navTotal])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Load mock data (will be replaced with real API calls)
  useEffect(() => {
    setInvites([])
    setRoles([])
    setMembers([])
    setBans([])
    setAuditLog([])
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

  const handleDeleteInvite = (inviteId: string) => {
    setInvites(prev => prev.filter(inv => inv.id !== inviteId))
  }

  // Ban management handlers
  const handleUnban = (banId: string) => {
    setBans(prev => prev.filter(ban => ban.id !== banId))
  }

  // Role management handlers
  const handleCreateRole = () => {
    if (!newRoleName.trim()) return
    const newRole: Role = {
      id: `role-${Date.now()}`,
      server_id: server.id,
      name: newRoleName.trim(),
      color: parseInt(newRoleColor.replace('#', ''), 16),
      position: roles.length,
      permissions: 0,
      is_default: false,
    }
    setRoles(prev => [...prev, newRole])
    setNewRoleName('')
    setNewRoleColor('#5865F2')
    setShowCreateRole(false)
  }

  const handleStartEditRole = (role: Role) => {
    setEditingRoleId(role.id)
    setEditingRoleName(role.name)
    setEditingRoleColor(`#${role.color.toString(16).padStart(6, '0')}`)
    setEditingRolePermissions(role.permissions)
    setSelectedRoleId(role.id)
  }

  const handleSaveRole = () => {
    if (!editingRoleId || !editingRoleName.trim()) return
    setRoles(prev => prev.map(r =>
      r.id === editingRoleId
        ? { ...r, name: editingRoleName.trim(), color: parseInt(editingRoleColor.replace('#', ''), 16), permissions: editingRolePermissions }
        : r
    ))
    setEditingRoleId(null)
    setEditingRoleName('')
    setEditingRoleColor('#000000')
    setEditingRolePermissions(0)
  }

  const handleCancelEditRole = () => {
    setEditingRoleId(null)
    setEditingRoleName('')
    setEditingRoleColor('#000000')
    setEditingRolePermissions(0)
    setSelectedRoleId(null)
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
    setSelectedRoleId(selectedRoleId === roleId ? null : roleId)
    if (editingRoleId && editingRoleId !== roleId) {
      setEditingRoleId(null)
      setEditingRoleName('')
      setEditingRoleColor('#000000')
      setEditingRolePermissions(0)
    }
  }

  const handleDeleteRole = (roleId: string) => {
    setRoles(prev => prev.filter(r => r.id !== roleId))
    setMembers(prev => prev.map(m => ({
      ...m,
      role_ids: (m.role_ids ?? []).filter((id: string) => id !== roleId)
    })))
  }

  const currentName = editedServer.name ?? server.name
  const currentDescription = editedServer.description ?? server.description ?? ''
  const currentIconUrl = editedServer.icon_url ?? server.icon_url ?? ''
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
              <div className={s.serverIcon} style={{ background: server.hue != null ? `oklch(60% 0.15 ${server.hue})` : 'oklch(60% 0 0)' }}>
                {server.name.charAt(0).toUpperCase()}
              </div>
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
            <h2 className={`${s.title} txt-title`}>
              {NAV.flatMap(g => g.items).find(i => i.id === section)?.label}
            </h2>
            <button className={s.closeBtn} onClick={onClose}>
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>

          <div className={`${s.scroll} scrollbar-thin`}>
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
                  <label className={`${s.label} txt-tiny txt-semibold`}>Icon URL</label>
                  <input
                    type="text"
                    className={`${s.input} txt-small`}
                    value={currentIconUrl}
                    onChange={e => handleFieldChange('icon_url', e.target.value)}
                    placeholder="https://..."
                  />
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
              <div className={s.section}>
                <div className={s.rolesLayout}>
                  {/* Left: Role List */}
                  <div className={s.rolesLeftPanel}>
                    <div className={s.sectionHeader}>
                      <h3 className="txt-small txt-semibold">Server Roles</h3>
                      <button
                        className={s.createBtn}
                        onClick={() => setShowCreateRole(true)}
                      >
                        <Plus size={14} strokeWidth={1.5} />
                        <span>Create Role</span>
                      </button>
                    </div>

                    {/* Create Role Form */}
                    {showCreateRole && (
                      <div className={s.createRoleForm}>
                        <div className={s.roleFormRow}>
                          <input
                            type="color"
                            value={newRoleColor}
                            onChange={e => setNewRoleColor(e.target.value)}
                            className={s.colorPicker}
                          />
                          <input
                            type="text"
                            value={newRoleName}
                            onChange={e => setNewRoleName(e.target.value)}
                            placeholder="Role name"
                            className={`${s.roleInput} txt-small`}
                            maxLength={32}
                          />
                          <button
                            className={s.saveRoleBtn}
                            onClick={handleCreateRole}
                            disabled={!newRoleName.trim()}
                          >
                            <Check size={16} strokeWidth={1.5} />
                          </button>
                          <button
                            className={s.cancelRoleBtn}
                            onClick={() => {
                              setShowCreateRole(false)
                              setNewRoleName('')
                              setNewRoleColor('#5865F2')
                            }}
                          >
                            <XCircle size={16} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    )}

                    <div className={`${s.rolesList} scrollbar-thin`}>
                      {roles.map(role => (
                        <div
                          key={role.id}
                          className={`${s.roleItem} ${selectedRoleId === role.id ? s.roleItemSelected : ''}`}
                          onClick={() => handleSelectRole(role.id)}
                        >
                          {editingRoleId === role.id ? (
                            <div className={s.roleEditRow}>
                              <input
                                type="color"
                                value={editingRoleColor}
                                onChange={e => setEditingRoleColor(e.target.value)}
                                className={s.colorPicker}
                              />
                              <input
                                type="text"
                                value={editingRoleName}
                                onChange={e => setEditingRoleName(e.target.value)}
                                className={`${s.roleInput} txt-small`}
                                maxLength={32}
                                autoFocus
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleSaveRole()
                                  if (e.key === 'Escape') handleCancelEditRole()
                                }}
                              />
                              <button className={s.saveRoleBtn} onClick={handleSaveRole}>
                                <Check size={16} strokeWidth={1.5} />
                              </button>
                              <button className={s.cancelRoleBtn} onClick={handleCancelEditRole}>
                                <XCircle size={16} strokeWidth={1.5} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className={s.roleInfo}>
                                <div
                                  className={s.roleColor}
                                  style={{ background: `#${role.color.toString(16).padStart(6, '0')}` }}
                                />
                                <span className={`${s.roleName} txt-small`}>{role.name}</span>
                                {role.is_default && <span className={s.defaultBadge}>Default</span>}
                              </div>
                              <div className={s.roleActions}>
                                <button
                                  className={s.editRoleBtn}
                                  onClick={e => { e.stopPropagation(); handleStartEditRole(role); }}
                                >
                                  <Edit2 size={14} strokeWidth={1.5} />
                                </button>
                                {!role.is_default && (
                                  <button
                                    className={s.deleteRoleBtn}
                                    onClick={e => { e.stopPropagation(); handleDeleteRole(role.id); }}
                                  >
                                    <Trash2 size={14} strokeWidth={1.5} />
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right: Permissions Editor */}
                  {selectedRoleId && (
                    <div className={s.rolesRightPanel}>
                      {(() => {
                        const role = roles.find(r => r.id === selectedRoleId)
                        if (!role) return null
                        const isEditing = editingRoleId === role.id
                        const currentPermissions = isEditing ? editingRolePermissions : role.permissions

                        return (
                          <>
                            <div className={s.permissionsHeader}>
                              <div>
                                <h4 className={`${s.permissionsTitle} txt-small txt-semibold`}>
                                  {role.name} Permissions
                                </h4>
                                <p className={`${s.permissionsSubtitle} txt-tiny`}>
                                  {members.filter(m => (m.role_ids ?? []).includes(role.id)).length} members
                                </p>
                              </div>
                              {!isEditing && (
                                <button
                                  className={s.editPermsBtn}
                                  onClick={() => handleStartEditRole(role)}
                                >
                                  <Edit2 size={14} strokeWidth={1.5} />
                                  <span className="txt-small">Edit</span>
                                </button>
                              )}
                            </div>

                            <div className={`${s.permissionsList} scrollbar-thin`}>
                              <PermissionGroup
                                title="General Server Permissions"
                                permissions={[
                                  { flag: P.VIEW_CHANNELS, label: 'View Channels', description: 'Allows members to view channels' },
                                  { flag: P.MANAGE_CHANNELS, label: 'Manage Channels', description: 'Allows members to create, edit, and delete channels' },
                                  { flag: P.MANAGE_SERVER, label: 'Manage Server', description: 'Allows members to change server name, icon, and other settings' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isEditing}
                                onToggle={handlePermissionToggle}
                              />

                              <PermissionGroup
                                title="Member Permissions"
                                permissions={[
                                  { flag: P.KICK_MEMBERS, label: 'Kick Members', description: 'Allows members to kick other members' },
                                  { flag: P.BAN_MEMBERS, label: 'Ban Members', description: 'Allows members to ban other members' },
                                  { flag: P.MANAGE_ROLES, label: 'Manage Roles', description: 'Allows members to create and manage roles' },
                                  { flag: P.CREATE_INVITE, label: 'Create Invites', description: 'Allows members to create invite links' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isEditing}
                                onToggle={handlePermissionToggle}
                              />

                              <PermissionGroup
                                title="Text Channel Permissions"
                                permissions={[
                                  { flag: P.SEND_MESSAGES, label: 'Send Messages', description: 'Allows members to send messages' },
                                  { flag: P.MANAGE_MESSAGES, label: 'Manage Messages', description: 'Allows members to delete and pin messages' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isEditing}
                                onToggle={handlePermissionToggle}
                              />

                              <div className={s.permissionItem}>
                                <div className={s.permissionInfo}>
                                  <span className={`${s.permissionLabel} txt-small txt-medium`}>Administrator</span>
                                  <span className={`${s.permissionDesc} txt-tiny`}>Grants all permissions and bypasses channel permissions</span>
                                </div>
                                {isEditing ? (
                                  <button
                                    className={`${s.permToggle} ${(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? s.permToggleActive : ''}`}
                                    onClick={() => handlePermissionToggle(P.ADMINISTRATOR)}
                                  >
                                    <Shield size={14} strokeWidth={1.5} />
                                  </button>
                                ) : (
                                  <span className={`${s.permStatus} txt-tiny ${(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? s.permStatusGranted : s.permStatusDenied}`}>
                                    {(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? 'Granted' : 'Not Granted'}
                                  </span>
                                )}
                              </div>
                            </div>

                            {isEditing && (
                              <div className={s.permissionsFooter}>
                                <button className={s.cancelBtn} onClick={handleCancelEditRole}>
                                  <span className="txt-small">Cancel</span>
                                </button>
                                <button className={s.saveBtn} onClick={handleSaveRole}>
                                  <Save size={14} strokeWidth={1.5} />
                                  <span className="txt-small">Save Changes</span>
                                </button>
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  )}
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
      {permissions.map(perm => (
        <div key={perm.flag} className={s.permissionItem}>
          <div className={s.permissionInfo}>
            <span className={`${s.permissionLabel} txt-small txt-medium`}>{perm.label}</span>
            <span className={`${s.permissionDesc} txt-tiny`}>{perm.description}</span>
          </div>
          {isEditing ? (
            <button
              className={`${s.permToggle} ${(currentPermissions & perm.flag) === perm.flag ? s.permToggleActive : ''}`}
              onClick={() => onToggle(perm.flag)}
            >
              {(currentPermissions & perm.flag) === perm.flag ? '\u2713' : '\u2715'}
            </button>
          ) : (
            <span className={`${s.permStatus} txt-tiny ${(currentPermissions & perm.flag) === perm.flag ? s.permStatusGranted : s.permStatusDenied}`}>
              {(currentPermissions & perm.flag) === perm.flag ? 'Granted' : 'Not Granted'}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
