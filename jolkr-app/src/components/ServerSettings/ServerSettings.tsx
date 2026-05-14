import {
  X, Info, Users, Shield, Link2, ScrollText, Trash2, Save, Plus, Check, Camera, Palette, Upload, Copy
} from 'lucide-react'
import { useState, useEffect, useLayoutEffect, useReducer, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import * as api from '../../api/client'
import { useLocaleFormatters } from '../../hooks/useLocaleFormatters'
import { useT, type T } from '../../hooks/useT'
import { buildInviteUrl } from '../../platform/config'
import { useAuthStore } from '../../stores/auth'
import { useServersStore } from '../../stores/servers'
import { useToast } from '../../stores/toast'
import * as P from '../../utils/permissions'
import { ServerIcon } from '../ServerIcon/ServerIcon'
import { SettingsShell, type SettingsNavGroup } from '../SettingsShell'
import { Select } from '../ui/Select'
import s from './ServerSettings.module.css'
import type { Invite, Role, Ban, AuditLogEntry, Server as ApiServer, Member } from '../../api/types'
import type { Dispatch, SetStateAction } from 'react'

type Server = ApiServer & { hue?: number | null; discoverable?: boolean }

type Section = 'overview' | 'roles' | 'invites' | 'bans' | 'audit' | 'delete'

/** API returns roles by position DESC; UI shows oldest / lowest position first (new roles at the end). */
function sortRolesByPosition(roles: Role[]): Role[] {
  return [...roles].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position
    return a.name.localeCompare(b.name)
  })
}

// ── Role editor state machine ─────────────────────────────────────
// Nine parallel useStates would drift when an action forgot a setter;
// the reducer keeps `editing` and `original` in lockstep with `selectedRoleId`
// and the Cancel/Save semantics live in one place.

interface RoleFields {
  name:        string
  color:       string  // `#rrggbb`
  permissions: number
}

interface RoleEditorState {
  selectedRoleId: string | null
  editing:        ({ id: string } & RoleFields) | null
  original:        RoleFields | null
}

const initialRoleEditor: RoleEditorState = { selectedRoleId: null, editing: null, original: null }

function roleToFields(role: Role): RoleFields {
  return {
    name:        role.name,
    color:       `#${role.color.toString(16).padStart(6, '0')}`,
    permissions: role.permissions,
  }
}

type RoleEditorAction =
  | { type: 'SELECT';            role: Role }
  | { type: 'ROLE_ADDED';        role: Role }
  | { type: 'ROLE_SAVED';        role: Role }
  | { type: 'ROLE_DELETED';      roleId: string; nextRole: Role | null }
  | { type: 'SET_NAME';          name: string }
  | { type: 'SET_COLOR';         color: string }
  | { type: 'TOGGLE_PERMISSION'; flag: number }
  | { type: 'SET_PERMISSIONS';   permissions: number }
  | { type: 'CANCEL' }

function roleEditorReducer(state: RoleEditorState, action: RoleEditorAction): RoleEditorState {
  switch (action.type) {
    case 'SELECT': {
      if (state.selectedRoleId === action.role.id) return state
      const fields = roleToFields(action.role)
      return { selectedRoleId: action.role.id, editing: { id: action.role.id, ...fields }, original: fields }
    }
    case 'ROLE_ADDED': {
      const fields = roleToFields(action.role)
      return { selectedRoleId: action.role.id, editing: { id: action.role.id, ...fields }, original: fields }
    }
    case 'ROLE_SAVED': {
      if (state.selectedRoleId !== action.role.id || !state.editing) return state
      const fields = roleToFields(action.role)
      return { ...state, editing: { id: action.role.id, ...fields }, original: fields }
    }
    case 'ROLE_DELETED': {
      if (state.selectedRoleId !== action.roleId) return state
      if (!action.nextRole) return initialRoleEditor
      const fields = roleToFields(action.nextRole)
      return { selectedRoleId: action.nextRole.id, editing: { id: action.nextRole.id, ...fields }, original: fields }
    }
    case 'SET_NAME':
      return state.editing ? { ...state, editing: { ...state.editing, name: action.name } } : state
    case 'SET_COLOR':
      return state.editing ? { ...state, editing: { ...state.editing, color: action.color } } : state
    case 'TOGGLE_PERMISSION': {
      if (!state.editing) return state
      const has = (state.editing.permissions & action.flag) === action.flag
      const next = has ? state.editing.permissions & ~action.flag : state.editing.permissions | action.flag
      return { ...state, editing: { ...state.editing, permissions: next } }
    }
    case 'SET_PERMISSIONS':
      return state.editing ? { ...state, editing: { ...state.editing, permissions: action.permissions } } : state
    case 'CANCEL':
      return state.editing && state.original
        ? { ...state, editing: { ...state.editing, ...state.original } }
        : state
  }
}

interface Props {
  server: Server
  onClose: () => void
  onUpdate: (serverId: string, data: Partial<Server>) => void
  onDelete?: (serverId: string) => void
  onLeave?: (serverId: string) => void
}

/** Backend audit-log action codes — keys into `serverSettings.audit.actions.*`. */
const AUDIT_ACTION_KEYS = new Set([
  'MemberJoin', 'MemberLeave', 'MemberUpdate',
  'ChannelCreate', 'ChannelUpdate', 'ChannelDelete',
  'RoleCreate', 'RoleUpdate', 'RoleDelete',
  'ServerUpdate', 'ServerDelete',
  'BanCreate', 'BanDelete', 'Kick',
])

export function ServerSettings({ server, onClose, onUpdate, onDelete, onLeave }: Props) {
  const { t, tx } = useT()
  const fmt = useLocaleFormatters()
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

  const [roleEditor, dispatchRoleEditor] = useReducer(roleEditorReducer, initialRoleEditor)
  const { selectedRoleId, editing: roleEditing, original: roleOriginal } = roleEditor

  // Load real data from API. Fast-switching servers used to let the older
  // server's responses overwrite the newer server's panels — the cancelled
  // flag gates every late setState so closing the previous server's data
  // mid-flight is a no-op. Roles go through the shared store cache so a
  // repeat-open / cross-component use (ChannelSettings, UserContextMenu)
  // hits a warm slice instead of refetching.
  useEffect(() => {
    const id = server.id
    let cancelled = false
    useServersStore.getState().fetchRoles(id).then(() => {
      if (cancelled) return
      const loadedRoles = useServersStore.getState().roles[id] ?? []
      setRoles(loadedRoles)
      const ordered = sortRolesByPosition(loadedRoles)
      if (ordered.length > 0) dispatchRoleEditor({ type: 'SELECT', role: ordered[0] })
    }).catch(() => { if (!cancelled) setRoles([]) })
    api.getMembersWithRoles(id).then(m => { if (!cancelled) setMembers(m) }).catch(() => { if (!cancelled) setMembers([]) })
    api.getInvites(id).then(i => { if (!cancelled) setInvites(i) }).catch(() => { if (!cancelled) setInvites([]) })
    api.getBans(id).then(b => { if (!cancelled) setBans(b) }).catch(() => { if (!cancelled) setBans([]) })
    api.getAuditLog(id).then(a => { if (!cancelled) setAuditLog(a) }).catch(() => { if (!cancelled) setAuditLog([]) })
    return () => { cancelled = true }
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
      setCreateInviteError((e as Error).message || t('serverSettings.invites.createError'))
    } finally {
      setCreatingInvite(false)
    }
  }

  const handleCopyInvite = async (invite: Invite) => {
    const url = buildInviteUrl(invite.code)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedInviteId(invite.id)
      showToast(t('serverSettings.invites.copiedToast'), 'success')
      setTimeout(() => setCopiedInviteId(prev => prev === invite.id ? null : prev), 2000)
    } catch {
      // Clipboard API can fail when the window isn't focused — show the URL so the user can copy manually
      showToast(t('serverSettings.invites.copyFailedToast', { url }), 'error', 6000)
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
      dispatchRoleEditor({ type: 'ROLE_ADDED', role: newRole })
    } catch (e) { console.warn('Failed to create role:', e) }
  }

  const handlePermissionToggle = (permissionFlag: number) => {
    dispatchRoleEditor({ type: 'TOGGLE_PERMISSION', flag: permissionFlag })
  }

  const handleSelectRole = (role: Role) => {
    // Radio button behavior: clicking the already-selected role is a no-op
    // and is gated inside the reducer.
    dispatchRoleEditor({ type: 'SELECT', role })
  }

  const handleDeleteRole = async (roleId: string) => {
    try {
      await api.deleteRole(roleId)
      const remaining = roles.filter(r => r.id !== roleId)
      setRoles(remaining)
      setMembers(prev => prev.map(m => ({
        ...m,
        role_ids: (m.role_ids ?? []).filter((id: string) => id !== roleId)
      })))
      const nextSorted = sortRolesByPosition(remaining)
      dispatchRoleEditor({ type: 'ROLE_DELETED', roleId, nextRole: nextSorted[0] ?? null })
    } catch (e) { console.warn('Failed to delete role:', e) }
  }

  const handleSaveRoleInfo = async () => {
    if (!roleEditing || !roleEditing.name.trim()) return
    try {
      const updated = await api.updateRole(roleEditing.id, {
        name: roleEditing.name.trim(),
        color: parseInt(roleEditing.color.replace('#', ''), 16),
        permissions: roleEditing.permissions,
      })
      setRoles(prev => prev.map(r => r.id === updated.id ? updated : r))
      dispatchRoleEditor({ type: 'ROLE_SAVED', role: updated })
    } catch (e) { console.warn('Failed to update role:', e) }
  }

  const handleCancelEditRoleInfo = () => {
    dispatchRoleEditor({ type: 'CANCEL' })
  }

  const hasRoleChanges = !!roleEditing && !!roleOriginal && (
    roleEditing.name        !== roleOriginal.name ||
    roleEditing.color       !== roleOriginal.color ||
    roleEditing.permissions !== roleOriginal.permissions
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

  // Revoke any blob URL we minted for the icon preview when it gets replaced
  // (new upload) or when the panel unmounts (close/save/cancel). The cleanup
  // runs against the previous render's `iconPreviewUrl`.
  useEffect(() => {
    if (!iconPreviewUrl || !iconPreviewUrl.startsWith('blob:')) return
    return () => { URL.revokeObjectURL(iconPreviewUrl) }
  }, [iconPreviewUrl])

  // Compose nav groups for the shell — counts and the danger variant for
  // Delete Server are computed per-render from the loaded data; labels are
  // pulled from the active locale via t().
  const navGroups: SettingsNavGroup<Section>[] = useMemo(() => [
    {
      group: t('serverSettings.nav.serverSettings'),
      items: [
        { id: 'overview' as const, label: t('serverSettings.nav.overview'), icon: <Info size={15} strokeWidth={1.5} /> },
        { id: 'roles' as const,    label: t('serverSettings.nav.roles'),    icon: <Shield size={15} strokeWidth={1.5} />, count: roles.length },
        { id: 'invites' as const,  label: t('serverSettings.nav.invites'),  icon: <Link2 size={15} strokeWidth={1.5} />, count: invites.length },
      ],
    },
    {
      group: t('serverSettings.nav.moderation'),
      items: [
        { id: 'bans' as const,  label: t('serverSettings.nav.bans'),     icon: <Shield size={15} strokeWidth={1.5} />, count: bans.length },
        { id: 'audit' as const, label: t('serverSettings.nav.auditLog'), icon: <ScrollText size={15} strokeWidth={1.5} />, count: auditLog.length },
      ],
    },
    {
      group: t('serverSettings.nav.dangerZone'),
      items: [
        { id: 'delete' as const, label: t('serverSettings.nav.deleteServer'), icon: <Trash2 size={15} strokeWidth={1.5} />, variant: 'danger' as const },
      ],
    },
  ], [t, roles.length, invites.length, bans.length, auditLog.length])

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
          <span className="txt-small">{t('serverSettings.leaveBtn')}</span>
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
                t={t}
              />
            )}

            {/* Roles Section */}
            {section === 'roles' && (
              <div className={s.sectionFull}>
                <div className={s.rolesLayout}>
                  {/* Left: Role List */}
                  <div className={s.rolesLeftPanel}>
                    <span className={`${s.rolesListHeader} txt-tiny txt-semibold`}>{t('serverSettings.roles.allRoles')}</span>
                    <div className={`${s.rolesList} scrollbar-thin`}>
                      {rolesOrdered.map(role => (
                        <button
                          key={role.id}
                          className={`${s.roleItem} ${selectedRoleId === role.id ? s.roleItemSelected : ''}`}
                          onClick={() => handleSelectRole(role)}
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
                      <span>{t('serverSettings.roles.createRole')}</span>
                    </button>
                  </div>

                  {/* Right: Role Editor */}
                  <div className={s.rolesRightPanel}>
                    {selectedRoleId && roleEditing && (() => {
                      const role = roles.find(r => r.id === selectedRoleId)
                      if (!role) return null
                      const isRoleSelected = true  // reducer keeps editing.id === selectedRoleId
                      const currentPermissions = roleEditing.permissions

                      return (
                        <>
                          {/* Role Info Header */}
                          <div className={s.roleInfoHeader}>
                            <div className={s.roleInfoTitle}>
                              <div className={s.roleInfoEditRow}>
                                <input
                                  type="color"
                                  value={roleEditing.color}
                                  onChange={e => dispatchRoleEditor({ type: 'SET_COLOR', color: e.target.value })}
                                  className={s.colorPickerInline}
                                />
                                <input
                                  type="text"
                                  value={roleEditing.name}
                                  onChange={e => dispatchRoleEditor({ type: 'SET_NAME', name: e.target.value })}
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
                              <h4 className={`${s.permissionsSectionTitle} txt-small txt-semibold`}>{t('serverSettings.roles.permissionsTitle')}</h4>
                              <button
                                className={s.clearPermsBtn}
                                onClick={() => dispatchRoleEditor({ type: 'SET_PERMISSIONS', permissions: 0 })}
                              >
                                {t('serverSettings.roles.clearPermissions')}
                              </button>
                            </div>
                            <div className={`${s.permissionsList} scrollbar-thin scroll-view-y`}>
                              <PermissionGroup
                                t={t}
                                titleKey="permissions.groupGeneral"
                                permissions={[
                                  { flag: P.VIEW_CHANNELS,   key: 'view_channels' },
                                  { flag: P.MANAGE_CHANNELS, key: 'manage_channels' },
                                  { flag: P.MANAGE_SERVER,   key: 'manage_server' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isRoleSelected}
                                onToggle={handlePermissionToggle}
                              />

                              <PermissionGroup
                                t={t}
                                titleKey="permissions.groupMember"
                                permissions={[
                                  { flag: P.KICK_MEMBERS,  key: 'kick_members' },
                                  { flag: P.BAN_MEMBERS,   key: 'ban_members' },
                                  { flag: P.MANAGE_ROLES,  key: 'manage_roles' },
                                  { flag: P.CREATE_INVITE, key: 'create_invite' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isRoleSelected}
                                onToggle={handlePermissionToggle}
                              />

                              <PermissionGroup
                                t={t}
                                titleKey="permissions.groupText"
                                permissions={[
                                  { flag: P.SEND_MESSAGES,   key: 'send_messages' },
                                  { flag: P.MANAGE_MESSAGES, key: 'manage_messages' },
                                  { flag: P.EMBED_LINKS,     key: 'embed_links' },
                                  { flag: P.ATTACH_FILES,    key: 'attach_files' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isRoleSelected}
                                onToggle={handlePermissionToggle}
                              />

                              <PermissionGroup
                                t={t}
                                titleKey="permissions.groupVoice"
                                permissions={[
                                  { flag: P.CONNECT,        key: 'connect' },
                                  { flag: P.SPEAK,          key: 'speak' },
                                  { flag: P.VIDEO,          key: 'video' },
                                  { flag: P.MUTE_MEMBERS,   key: 'mute_members' },
                                  { flag: P.DEAFEN_MEMBERS, key: 'deafen_members' },
                                ]}
                                currentPermissions={currentPermissions}
                                isEditing={isRoleSelected}
                                onToggle={handlePermissionToggle}
                              />

                              <div className={s.permissionItem}>
                                <div className={s.permissionInfo}>
                                  <span className={`${s.permissionLabel} txt-small txt-medium`}>{t('permissions.administrator.label')}</span>
                                  <span className={`${s.permissionDesc} txt-tiny`}>{t('permissions.administrator.desc')}</span>
                                </div>
                                <div className={s.permToggleGroup}>
                                  <button
                                    className={`${s.permToggleBtn} ${(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? s.permToggleBtnActive : ''}`}
                                    onClick={isRoleSelected ? () => handlePermissionToggle(P.ADMINISTRATOR) : undefined}
                                    disabled={!isRoleSelected}
                                    aria-label={(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? t('permissions.ariaDisable', { label: t('permissions.administrator.label') }) : t('permissions.ariaEnable', { label: t('permissions.administrator.label') })}
                                  >
                                    <Check size={16} strokeWidth={2.5} />
                                  </button>
                                  <button
                                    className={`${s.permToggleBtn} ${(currentPermissions & P.ADMINISTRATOR) !== P.ADMINISTRATOR ? s.permToggleBtnDeny : ''}`}
                                    onClick={isRoleSelected ? () => handlePermissionToggle(P.ADMINISTRATOR) : undefined}
                                    disabled={!isRoleSelected}
                                    aria-label={(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? t('permissions.ariaDisable', { label: t('permissions.administrator.label') }) : t('permissions.ariaEnable', { label: t('permissions.administrator.label') })}
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
                                  <span>{t('serverSettings.roles.deleteRole')}</span>
                                </button>
                              )}
                            </div>
                            <div className={s.roleFooterRight}>
                              <button
                                className={s.cancelBtn}
                                onClick={handleCancelEditRoleInfo}
                              >
                                {t('common.cancel')}
                              </button>
                              <button
                                className={s.saveBtn}
                                onClick={handleSaveRoleInfo}
                                disabled={!hasRoleChanges}
                              >
                                <Save size={14} strokeWidth={1.5} />
                                <span>{t('common.save')}</span>
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
                    <label className={`${s.inviteCreateLabel} txt-tiny txt-semibold`}>{t('serverSettings.invites.expireAfter')}</label>
                    <Select
                      value={createInviteMaxAge}
                      onChange={e => setCreateInviteMaxAge(Number(e.target.value))}
                      disabled={creatingInvite}
                    >
                      <option value={0}>{t('serverSettings.invites.expireNever')}</option>
                      <option value={1800}>{t('serverSettings.invites.expire30m')}</option>
                      <option value={3600}>{t('serverSettings.invites.expire1h')}</option>
                      <option value={21600}>{t('serverSettings.invites.expire6h')}</option>
                      <option value={43200}>{t('serverSettings.invites.expire12h')}</option>
                      <option value={86400}>{t('serverSettings.invites.expire1d')}</option>
                      <option value={604800}>{t('serverSettings.invites.expire7d')}</option>
                    </Select>
                  </div>
                  <div className={s.inviteCreateField}>
                    <label className={`${s.inviteCreateLabel} txt-tiny txt-semibold`}>{t('serverSettings.invites.maxUses')}</label>
                    <Select
                      value={createInviteMaxUses}
                      onChange={e => setCreateInviteMaxUses(Number(e.target.value))}
                      disabled={creatingInvite}
                    >
                      <option value={0}>{t('serverSettings.invites.usesUnlimited')}</option>
                      <option value={1}>{t('serverSettings.invites.uses1')}</option>
                      <option value={5}>{t('serverSettings.invites.uses5')}</option>
                      <option value={10}>{t('serverSettings.invites.uses10')}</option>
                      <option value={25}>{t('serverSettings.invites.uses25')}</option>
                      <option value={50}>{t('serverSettings.invites.uses50')}</option>
                      <option value={100}>{t('serverSettings.invites.uses100')}</option>
                    </Select>
                  </div>
                  <button
                    className={`${s.createBtn} ${s.inviteRowBtn}`}
                    onClick={handleCreateInvite}
                    disabled={creatingInvite}
                  >
                    <Link2 size={14} strokeWidth={1.5} />
                    {creatingInvite ? t('serverSettings.invites.creating') : t('serverSettings.invites.createBtn')}
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
                    <span className={`${s.emptyStateTitle} txt-small txt-medium`}>{t('serverSettings.invites.emptyTitle')}</span>
                    <span className={`${s.emptyStateDesc} txt-small`}>{t('serverSettings.invites.emptyDesc')}</span>
                  </div>
                ) : (
                  <>
                    <div className={s.sectionHeaderWithTitle}>
                      <span className={`${s.sectionTitle} txt-tiny txt-semibold`}>{t('serverSettings.invites.allInvites')}</span>
                    </div>
                    <div className={s.invitesList}>
                      {invites.map(invite => (
                        <div key={invite.id} className={s.inviteItem}>
                          <div className={s.inviteInfo}>
                            <button
                              type="button"
                              className={s.inviteCopyBtn}
                              onClick={() => handleCopyInvite(invite)}
                              title={t('serverSettings.invites.copyTitle')}
                            >
                              <code className={s.inviteCode}>{invite.code}</code>
                              {copiedInviteId === invite.id
                                ? <Check size={13} strokeWidth={1.75} />
                                : <Copy size={13} strokeWidth={1.5} />}
                            </button>
                            <span className={`${s.inviteMeta} txt-tiny`}>
                              {t('serverSettings.invites.usesProgress', { used: invite.use_count, max: invite.max_uses ?? '\u221E' })}
                              {invite.expires_at && ` \u00B7 ${t('serverSettings.invites.expiresAt', { date: fmt.formatDate(invite.expires_at, 'long') })}`}
                            </span>
                          </div>
                          <button
                            className={s.revokeBtn}
                            onClick={() => handleDeleteInvite(invite.id)}
                          >
                            {t('serverSettings.invites.revoke')}
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
                    <span className={`${s.emptyStateTitle} txt-small txt-medium`}>{t('serverSettings.bans.emptyTitle')}</span>
                    <span className={`${s.emptyStateDesc} txt-small`}>{t('serverSettings.bans.emptyDesc')}</span>
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
                              {ban.reason ? t('serverSettings.bans.reasonLabel', { reason: ban.reason }) : t('serverSettings.bans.noReason')}
                              {' \u00B7 '}
                              {t('serverSettings.bans.bannedAt', { date: fmt.formatDate(ban.created_at, 'long') })}
                            </span>
                          </div>
                        </div>
                        <button
                          className={s.unbanBtn}
                          onClick={() => handleUnban(ban.id)}
                        >
                          {t('serverSettings.bans.unban')}
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
                    <span className={`${s.emptyStateTitle} txt-small txt-medium`}>{t('serverSettings.audit.emptyTitle')}</span>
                    <span className={`${s.emptyStateDesc} txt-small`}>{t('serverSettings.audit.emptyDesc')}</span>
                  </div>
                ) : (
                  <div className={s.auditList}>
                    {(() => {
                      // Group entries by day — using locale-aware long-form date
                      // so the header reads naturally in every shipped locale.
                      const grouped = auditLog.reduce((acc, entry) => {
                        const date = fmt.formatDate(entry.created_at, 'long')
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
                                      {AUDIT_ACTION_KEYS.has(entry.action_type)
                                        ? t(`serverSettings.audit.actions.${entry.action_type}`)
                                        : entry.action_type.replace(/([A-Z])/g, ' $1').trim()}
                                    </span>
                                    <span className={`${s.auditTime} txt-tiny`}>
                                      {fmt.formatDate(entry.created_at, 'short')} {fmt.formatTime(entry.created_at)}
                                    </span>
                                  </div>
                                  <div className={s.auditDetails}>
                                    <span className={`${s.auditUser} txt-tiny`}>
                                      {t('serverSettings.audit.byUser', { name: members.find(m => m.user_id === entry.user_id)?.nickname || entry.user_id })}
                                    </span>
                                    {entry.target_type && entry.target_id && (
                                      <span className={`${s.auditTarget} txt-tiny`}>
                                        {t('serverSettings.audit.onTarget', { type: entry.target_type, idShort: entry.target_id.slice(0, 8) })}
                                      </span>
                                    )}
                                  </div>
                                  {entry.reason && (
                                    <span className={`${s.auditReason} txt-tiny`}>
                                      {t('serverSettings.audit.reasonLabel', { reason: entry.reason })}
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
                  <h3 className={`${s.dangerTitle} txt-small txt-semibold`}>{t('serverSettings.delete.title')}</h3>
                  <p className={`${s.dangerText} txt-small`}>
                    {t('serverSettings.delete.warning')}
                  </p>
                  <button
                    className={s.deleteBtn}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                    <span>{t('serverSettings.delete.btn')}</span>
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
          <h3 className="txt-small txt-semibold">{t('serverSettings.leaveConfirm.title')}</h3>
          <p className={`${s.confirmText} txt-small`}>
            {tx('serverSettings.leaveConfirm.body', { serverName: <strong>{server.name}</strong> })}
          </p>
          <div className={s.confirmActions}>
            <button className={s.cancelBtn} onClick={() => setShowLeaveConfirm(false)}>{t('common.cancel')}</button>
            <button
              className={s.confirmLeaveBtn}
              onClick={() => { onLeave?.(server.id); onClose() }}
            >
              {t('serverSettings.leaveConfirm.confirm')}
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
          <h3 className="txt-small txt-semibold">{t('serverSettings.deleteConfirm.title')}</h3>
          <p className={`${s.confirmText} txt-small`}>
            {tx('serverSettings.deleteConfirm.body', { serverName: <strong>{server.name}</strong> })}
          </p>
          <div className={s.confirmActions}>
            <button className={s.cancelBtn} onClick={() => setShowDeleteConfirm(false)}>{t('common.cancel')}</button>
            <button
              className={s.confirmDeleteBtn}
              onClick={() => { onDelete?.(server.id); onClose() }}
            >
              {t('serverSettings.deleteConfirm.confirm')}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )}
    </>
  )
}

// Overview — solid colors match Settings.tsx AccountSection (BANNER_COLORS).
// `nameKey` looks up the localised swatch label under `settings.bannerColors.*`
// (shared with the profile-banner picker in Settings.tsx).
const BANNER_COLORS = [
  { nameKey: 'sage',  value: 'oklch(60% 0.1 136)' },
  { nameKey: 'gold',  value: 'oklch(65% 0.12 85)' },
  { nameKey: 'ocean', value: 'oklch(60% 0.12 215)' },
  { nameKey: 'royal', value: 'oklch(55% 0.18 280)' },
  { nameKey: 'berry', value: 'oklch(55% 0.18 340)' },
  { nameKey: 'coral', value: 'oklch(60% 0.15 25)' },
] as const

function hueFromOklch(oklch: string): number | null {
  const m = oklch.match(/oklch\([^\s]+\s+[^\s]+\s+(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

const BANNER_PRESETS = {
  gradients: [
    { nameKey: 'oceanBreeze', value: 'linear-gradient(135deg, oklch(60% 0.12 215), oklch(55% 0.1 180))' },
    { nameKey: 'sunsetGlow',  value: 'linear-gradient(135deg, oklch(65% 0.15 45), oklch(55% 0.18 340))' },
    { nameKey: 'forestMist',  value: 'linear-gradient(135deg, oklch(60% 0.1 136), oklch(55% 0.08 160))' },
    { nameKey: 'royalVelvet', value: 'linear-gradient(135deg, oklch(55% 0.18 280), oklch(50% 0.15 320))' },
    { nameKey: 'berryBurst',  value: 'linear-gradient(135deg, oklch(55% 0.18 340), oklch(60% 0.12 25))' },
    { nameKey: 'midnight',    value: 'linear-gradient(135deg, oklch(40% 0.05 250), oklch(35% 0.08 280))' },
  ],
} as const

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
  /** Translate function passed from the parent so consumer ergonomics stay
   *  hook-free in this presentational subcomponent. */
  t: T['t']
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
  t,
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
              title={t('serverSettings.overview.bannerTitle')}
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
              aria-label={t('serverSettings.overview.bannerTitle')}
            >
              <div className={s.bannerPopoverSection}>
                <span className={`${s.bannerPopoverLabel} txt-tiny txt-semibold`}>{t('serverSettings.overview.bannerSolid')}</span>
                <div className={s.bannerPopoverSwatches}>
                  {BANNER_COLORS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`${s.colorPickerSwatch} ${isSolidColorActive(c.value) ? s.colorPickerSwatchActive : ''}`}
                      style={{ background: c.value }}
                      onClick={() => handleBannerColorSelect(c.value)}
                      title={t(`settings.bannerColors.${c.nameKey}`)}
                    />
                  ))}
                </div>
              </div>

              <div className={s.bannerPopoverSection}>
                <span className={`${s.bannerPopoverLabel} txt-tiny txt-semibold`}>{t('serverSettings.overview.bannerGradients')}</span>
                <div className={s.bannerPopoverSwatches}>
                  {BANNER_PRESETS.gradients.map(g => (
                    <button
                      key={g.nameKey}
                      type="button"
                      className={`${s.colorPickerSwatch} ${currentGradient === g.value ? s.colorPickerSwatchActive : ''}`}
                      style={{ background: g.value }}
                      onClick={() => handleGradientSelect(g.value)}
                      title={t(`serverSettings.gradients.${g.nameKey}`)}
                    />
                  ))}
                </div>
              </div>

              <div className={s.bannerPopoverSection}>
                <span className={`${s.bannerPopoverLabel} txt-tiny txt-semibold`}>{t('serverSettings.overview.bannerImage')}</span>
                <div className={s.bannerPopoverImageRow}>
                  <input
                    type="text"
                    className={s.bannerPopoverUrlInput}
                    value={currentBannerUrl}
                    onChange={e => handleImageUrlChange(e.target.value)}
                    placeholder={t('serverSettings.overview.bannerImageUrl')}
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
                    {bannerUploading ? t('serverSettings.overview.bannerUploading') : t('serverSettings.overview.bannerUpload')}
                  </button>
                </div>
                {currentBannerUrl ? (
                  <button
                    type="button"
                    className={s.bannerPopoverClearImage}
                    onClick={() => handleImageUrlChange('')}
                  >
                    {t('serverSettings.overview.bannerRemove')}
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
                <img src={iconPreviewUrl} alt={t('serverSettings.overview.iconAlt')} className={s.previewAvatarImg} />
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
              placeholder={t('serverSettings.overview.namePlaceholder')}
              maxLength={100}
            />
            <textarea
              className={s.inlineDescInput}
              value={currentDescription}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              placeholder={t('serverSettings.overview.descriptionPlaceholder')}
              rows={2}
              maxLength={500}
            />
          </div>
        </div>
      </div>

      {/* Discoverable Toggle */}
      <div className={s.simpleFieldRow}>
        <div className={s.toggleMeta}>
          <span className={`${s.toggleLabel} txt-small txt-medium`}>{t('serverSettings.overview.discoveryLabel')}</span>
          <span className={`${s.toggleDesc} txt-tiny`}>{t('serverSettings.overview.discoveryDesc')}</span>
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
            {t('common.saveChanges')}
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

// Permission Group Component — labels + descriptions resolved against the
// shared `permissions.<key>.label/.desc` namespace so the same strings stay
// in sync between server-wide role permissions and per-channel overwrites.
interface PermissionDef {
  flag: number
  /** snake_case key matching the shared `permissions` JSON namespace. */
  key: string
}

function PermissionGroup({
  t,
  titleKey,
  permissions,
  currentPermissions,
  isEditing,
  onToggle
}: {
  t: T['t']
  titleKey: string
  permissions: PermissionDef[]
  currentPermissions: number
  isEditing: boolean
  onToggle: (flag: number) => void
}) {
  return (
    <div className={s.permissionGroup}>
      <h5 className={`${s.permissionGroupTitle} txt-tiny txt-semibold`}>{t(titleKey)}</h5>
      {permissions.map(perm => {
        const isGranted = (currentPermissions & perm.flag) === perm.flag
        const label = t(`permissions.${perm.key}.label`)
        const aria = isGranted
          ? t('permissions.ariaDisable', { label })
          : t('permissions.ariaEnable', { label })
        return (
          <div key={perm.flag} className={s.permissionItem}>
            <div className={s.permissionInfo}>
              <span className={`${s.permissionLabel} txt-small txt-medium`}>{label}</span>
              <span className={`${s.permissionDesc} txt-tiny`}>{t(`permissions.${perm.key}.desc`)}</span>
            </div>
            <div className={s.permToggleGroup}>
              <button
                className={`${s.permToggleBtn} ${isGranted ? s.permToggleBtnActive : ''}`}
                onClick={isEditing ? () => onToggle(perm.flag) : undefined}
                disabled={!isEditing}
                aria-label={aria}
              >
                <Check size={16} strokeWidth={2.5} />
              </button>
              <button
                className={`${s.permToggleBtn} ${!isGranted ? s.permToggleBtnDeny : ''}`}
                onClick={isEditing ? () => onToggle(perm.flag) : undefined}
                disabled={!isEditing}
                aria-label={aria}
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
