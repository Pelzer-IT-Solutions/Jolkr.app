import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Shield, Plus, Trash2, User, Users } from 'lucide-react'
import type { Channel, PermissionOverwrite, MemberDisplay } from '../../types'
import type { Role } from '../../api/types'
import * as P from '../../utils/permissions'
import { displayName } from '../../utils/format'
import { revealDelay } from '../../utils/animations'
import { useRevealAnimation } from '../../hooks/useRevealAnimation'
import Avatar from '../Avatar'
import s from './ChannelPermissions.module.css'

interface Props {
  channel: Channel
  roles: Role[]
  members: MemberDisplay[]
  isOpen: boolean
  onClose: () => void
  onSave?: (overwrites: PermissionOverwrite[]) => void
}

const ALL_PERMISSIONS = [
  { flag: P.VIEW_CHANNELS, label: 'View Channel', description: 'Allows members to view the channel' },
  { flag: P.SEND_MESSAGES, label: 'Send Messages', description: 'Allows members to send messages' },
  { flag: P.MANAGE_MESSAGES, label: 'Manage Messages', description: 'Allows members to delete and pin messages' },
  { flag: P.CREATE_INVITE, label: 'Create Invites', description: 'Allows members to create invite links' },
]

export function ChannelPermissions({ channel, roles, members, isOpen, onClose, onSave }: Props) {
  const [overwrites, setOverwrites] = useState<PermissionOverwrite[]>([])
  const [selectedTarget, setSelectedTarget] = useState<{ type: 'role' | 'member'; id: string } | null>(null)
  const isRevealing = useRevealAnimation(8, [isOpen], isOpen)
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setOverwrites([])
      setSelectedTarget(null)
      setShowAddModal(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleAddOverwrite = (targetType: 'role' | 'member', targetId: string) => {
    const newOverwrite: PermissionOverwrite = {
      id: `ow-${Date.now()}`,
      channel_id: channel.id,
      target_type: targetType,
      target_id: targetId,
      allow: 0,
      deny: 0,
    }
    setOverwrites(prev => [...prev, newOverwrite])
    setSelectedTarget({ type: targetType, id: targetId })
    setShowAddModal(false)
  }

  const handleRemoveOverwrite = (overwriteId: string) => {
    setOverwrites(prev => prev.filter(ow => ow.id !== overwriteId))
    if (selectedTarget && overwrites.find(ow => ow.id === overwriteId)?.target_id === selectedTarget.id) {
      setSelectedTarget(null)
    }
  }

  const handlePermissionChange = (permissionFlag: number, action: 'allow' | 'deny' | 'neutral') => {
    if (!selectedTarget) return

    setOverwrites(prev => prev.map(ow => {
      if (ow.target_id !== selectedTarget.id || ow.target_type !== selectedTarget.type) return ow

      let newAllow = ow.allow
      let newDeny = ow.deny

      // Clear from both first
      newAllow &= ~permissionFlag
      newDeny &= ~permissionFlag

      // Set based on action
      if (action === 'allow') newAllow |= permissionFlag
      if (action === 'deny') newDeny |= permissionFlag

      return { ...ow, allow: newAllow, deny: newDeny }
    }))
  }

  const getPermissionState = (permissionFlag: number): 'allow' | 'deny' | 'neutral' => {
    if (!selectedTarget) return 'neutral'
    const ow = overwrites.find(o => o.target_id === selectedTarget.id && o.target_type === selectedTarget.type)
    if (!ow) return 'neutral'
    if ((ow.allow & permissionFlag) === permissionFlag) return 'allow'
    if ((ow.deny & permissionFlag) === permissionFlag) return 'deny'
    return 'neutral'
  }

  const handleSave = () => {
    onSave?.(overwrites)
    onClose()
  }

  const getTargetName = (ow: PermissionOverwrite): string => {
    if (ow.target_type === 'role') {
      return roles.find(r => r.id === ow.target_id)?.name || 'Unknown Role'
    }
    const member = members.find(m => m.user_id === ow.target_id)
    return member ? displayName(member) : 'Unknown User'
  }

  const getTargetIcon = (ow: PermissionOverwrite) => {
    if (ow.target_type === 'role') return <Users size={14} strokeWidth={1.5} />
    return <User size={14} strokeWidth={1.5} />
  }

  const availableRoles = roles.filter(r => !overwrites.some(ow => ow.target_type === 'role' && ow.target_id === r.id))
  const availableMembers = members.filter(m => !overwrites.some(ow => ow.target_type === 'member' && ow.target_id === m.user_id))

  return createPortal(
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>
        {/* Header */}
        <div className={s.header}>
          <div className={s.headerIcon}>
            <Shield size={20} strokeWidth={1.5} />
          </div>
          <div>
            <h3 className={`${s.title} txt-title`}>Channel Permissions</h3>
            <p className={`${s.subtitle} txt-tiny`}>#{channel.name}</p>
          </div>
          <button className={s.closeBtn} onClick={onClose}>
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Content */}
        <div className={s.content}>
          {/* Left: Overwrite List */}
          <div className={s.leftPanel}>
            <div className={s.panelHeader}>
              <span className={`${s.panelTitle} txt-small txt-semibold`}>Permission Targets</span>
              <button className={s.addBtn} onClick={() => setShowAddModal(true)}>
                <Plus size={14} strokeWidth={1.5} />
              </button>
            </div>

            <div className={`${s.targetList} scrollbar-thin`}>
              {overwrites.length === 0 ? (
                <p className={`${s.empty} txt-small`}>No permission overwrites. Click + to add one.</p>
              ) : (
                overwrites.map((ow, i) => (
                  <button
                    key={ow.id}
                    className={`${s.targetItem} ${selectedTarget?.id === ow.target_id && selectedTarget?.type === ow.target_type ? s.selected : ''} ${isRevealing ? 'revealing' : ''}`}
                    style={isRevealing ? { '--reveal-delay': `${revealDelay(i)}ms` } as React.CSSProperties : undefined}
                    onClick={() => setSelectedTarget({ type: ow.target_type, id: ow.target_id })}
                  >
                    <span className={s.targetIcon}>{getTargetIcon(ow)}</span>
                    <span className={`${s.targetName} txt-small txt-truncate`}>{getTargetName(ow)}</span>
                    <button
                      className={s.removeBtn}
                      onClick={e => { e.stopPropagation(); handleRemoveOverwrite(ow.id) }}
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: Permission Editor */}
          <div className={s.rightPanel}>
            {selectedTarget ? (
              <>
                <div className={s.editorHeader}>
                  <span className={`${s.editorTitle} txt-small txt-semibold`}>
                    {selectedTarget.type === 'role' ? 'Role' : 'Member'} Permissions
                  </span>
                </div>

                <div className={s.permissionList}>
                  {ALL_PERMISSIONS.map(perm => {
                    const state = getPermissionState(perm.flag)
                    return (
                      <div key={perm.flag} className={s.permissionRow}>
                        <div className={s.permissionInfo}>
                          <span className={`${s.permissionLabel} txt-small txt-medium`}>{perm.label}</span>
                          <span className={`${s.permissionDesc} txt-tiny`}>{perm.description}</span>
                        </div>
                        <div className={s.permissionToggles}>
                          <button
                            className={`${s.toggleBtn} ${state === 'allow' ? s.allow : ''}`}
                            onClick={() => handlePermissionChange(perm.flag, state === 'allow' ? 'neutral' : 'allow')}
                            title="Allow"
                          >
                            ✓
                          </button>
                          <button
                            className={`${s.toggleBtn} ${state === 'neutral' ? s.neutral : ''}`}
                            onClick={() => handlePermissionChange(perm.flag, 'neutral')}
                            title="Neutral (inherit from role/@everyone)"
                          >
                            /
                          </button>
                          <button
                            className={`${s.toggleBtn} ${state === 'deny' ? s.deny : ''}`}
                            onClick={() => handlePermissionChange(perm.flag, state === 'deny' ? 'neutral' : 'deny')}
                            title="Deny"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className={s.legend}>
                  <span className={`${s.legendItem} txt-tiny`}><span className={s.allowDot} /> Allow</span>
                  <span className={`${s.legendItem} txt-tiny`}><span className={s.neutralDot} /> Neutral (inherit)</span>
                  <span className={`${s.legendItem} txt-tiny`}><span className={s.denyDot} /> Deny</span>
                </div>
              </>
            ) : (
              <div className={s.noSelection}>
                <Shield size={48} strokeWidth={1} className={s.noSelectionIcon} />
                <p className={`${s.noSelectionText} txt-small`}>Select a role or member to edit permissions</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={s.footer}>
          <button className={s.cancelBtn} onClick={onClose}>
            <span className="txt-small">Cancel</span>
          </button>
          <button className={s.saveBtn} onClick={handleSave}>
            <Shield size={14} strokeWidth={1.5} />
            <span className="txt-small">Save Permissions</span>
          </button>
        </div>

        {/* Add Target Modal */}
        {showAddModal && createPortal(
          <div className={s.addModalOverlay} onClick={() => setShowAddModal(false)}>
            <div className={s.addModal} onClick={e => e.stopPropagation()}>
              <h4 className={`${s.addModalTitle} txt-small txt-semibold`}>Add Permission Target</h4>

              {availableRoles.length > 0 && (
                <div className={s.addSection}>
                  <span className={`${s.addSectionTitle} txt-tiny`}>Roles</span>
                  {availableRoles.map(role => (
                    <button
                      key={role.id}
                      className={s.addOption}
                      onClick={() => handleAddOverwrite('role', role.id)}
                    >
                      <Users size={14} strokeWidth={1.5} />
                      <span className={`${s.addOptionName} txt-small`}>{role.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {availableMembers.length > 0 && (
                <div className={s.addSection}>
                  <span className={`${s.addSectionTitle} txt-tiny`}>Members</span>
                  <div className={`${s.membersList} scrollbar-thin`}>
                    {availableMembers.map(member => (
                      <button
                        key={member.user_id}
                        className={s.addOption}
                        onClick={() => handleAddOverwrite('member', member.user_id)}
                      >
                        <Avatar url={member?.avatar_url} name={displayName(member)} size="xs" userId={member.user_id} color={member.color} />
                        <span className={`${s.addOptionName} txt-small`}>{displayName(member)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {availableRoles.length === 0 && availableMembers.length === 0 && (
                <p className={`${s.empty} txt-small`}>All roles and members already have permissions set.</p>
              )}

              <button className={s.addModalClose} onClick={() => setShowAddModal(false)}>
                <span className="txt-small">Cancel</span>
              </button>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>,
    document.body
  )
}
