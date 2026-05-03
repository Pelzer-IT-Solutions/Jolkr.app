import { Plus, Save, Trash2, Check, X } from 'lucide-react'
import * as P from '../../utils/permissions'
import type { useRoleEdit } from './useRoleEdit'
import s from './ServerSettings.module.css'

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
  onToggle,
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

interface Props {
  edit: ReturnType<typeof useRoleEdit>
}

export function RolesTab({ edit }: Props) {
  const {
    roles, rolesOrdered, selectedRoleId,
    editingRoleId, editingRoleName, setEditingRoleName,
    editingRoleColor, setEditingRoleColor,
    editingRolePermissions, hasRoleChanges,
    handleCreate, handleSelect, handleDelete, handleSave, handleCancel,
    togglePermission, clearPermissions,
  } = edit

  const role = selectedRoleId ? roles.find(r => r.id === selectedRoleId) : null

  return (
    <div className={s.sectionFull}>
      <div className={s.rolesLayout}>
        {/* Left: Role List */}
        <div className={s.rolesLeftPanel}>
          <span className={`${s.rolesListHeader} txt-tiny txt-semibold`}>All Roles</span>
          <div className={`${s.rolesList} scrollbar-thin`}>
            {rolesOrdered.map(r => (
              <button
                key={r.id}
                className={`${s.roleItem} ${selectedRoleId === r.id ? s.roleItemSelected : ''}`}
                onClick={() => handleSelect(r.id)}
              >
                <div
                  className={s.roleColorDot}
                  style={{ background: `#${r.color.toString(16).padStart(6, '0')}` }}
                />
                <span className={`${s.roleName} txt-small`}>{r.name}</span>
              </button>
            ))}
          </div>

          {/* Create Role Button */}
          <button
            className={s.createRoleBtn}
            onClick={handleCreate}
          >
            <Plus size={14} strokeWidth={1.5} />
            <span>Create Role</span>
          </button>
        </div>

        {/* Right: Role Editor */}
        <div className={s.rolesRightPanel}>
          {role && (() => {
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
                          if (e.key === 'Enter') handleSave()
                          if (e.key === 'Escape') handleCancel()
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
                      onClick={clearPermissions}
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
                      onToggle={togglePermission}
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
                      onToggle={togglePermission}
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
                      onToggle={togglePermission}
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
                      onToggle={togglePermission}
                    />

                    <div className={s.permissionItem}>
                      <div className={s.permissionInfo}>
                        <span className={`${s.permissionLabel} txt-small txt-medium`}>Administrator</span>
                        <span className={`${s.permissionDesc} txt-tiny`}>Grants all permissions and bypasses channel permissions. This is a dangerous permission!</span>
                      </div>
                      <div className={s.permToggleGroup}>
                        <button
                          className={`${s.permToggleBtn} ${(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? s.permToggleBtnActive : ''}`}
                          onClick={isRoleSelected ? () => togglePermission(P.ADMINISTRATOR) : undefined}
                          disabled={!isRoleSelected}
                          aria-label={(currentPermissions & P.ADMINISTRATOR) === P.ADMINISTRATOR ? 'Disable Administrator' : 'Enable Administrator'}
                        >
                          <Check size={16} strokeWidth={2.5} />
                        </button>
                        <button
                          className={`${s.permToggleBtn} ${(currentPermissions & P.ADMINISTRATOR) !== P.ADMINISTRATOR ? s.permToggleBtnDeny : ''}`}
                          onClick={isRoleSelected ? () => togglePermission(P.ADMINISTRATOR) : undefined}
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
                        onClick={() => handleDelete(role.id)}
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                        <span>Delete Role</span>
                      </button>
                    )}
                  </div>
                  <div className={s.roleFooterRight}>
                    <button
                      className={s.cancelBtn}
                      onClick={handleCancel}
                    >
                      Cancel
                    </button>
                    <button
                      className={s.saveBtn}
                      onClick={handleSave}
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
  )
}

