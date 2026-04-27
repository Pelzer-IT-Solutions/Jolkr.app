import { useState, useEffect } from 'react'
import {
  Hash, Lock, Shield, Save, Plus, Trash2, Check, XCircle
} from 'lucide-react'
import type { Channel as ApiChannel, Role, ChannelOverwrite } from '../../api/types'
import * as api from '../../api/client'
import * as P from '../../utils/permissions'
import { revealDelay } from '../../utils/animations'
import { useRevealAnimation } from '../../hooks/useRevealAnimation'
import { SettingsShell, type SettingsNavGroup } from '../SettingsShell'
import s from './ChannelSettings.module.css'

type Section = 'overview' | 'permissions'

interface Props {
  channel: ApiChannel
  serverId: string
  serverPermissions: number
  onClose: () => void
  onUpdate: (channelId: string, data: Partial<ApiChannel>) => void
}

const NAV: SettingsNavGroup<Section>[] = [
  {
    group: 'Channel Settings',
    items: [
      { id: 'overview', label: 'Overview', icon: <Hash size={15} strokeWidth={1.5} /> },
      { id: 'permissions', label: 'Permissions', icon: <Shield size={15} strokeWidth={1.5} /> },
    ],
  },
]

export function ChannelSettings({ channel, serverId, serverPermissions, onClose, onUpdate }: Props) {
  const canManage = P.hasPermission(serverPermissions, P.MANAGE_CHANNELS)

  const [section, setSection] = useState<Section>('overview')
  const [editedChannel, setEditedChannel] = useState<Partial<ApiChannel>>({})
  const [hasChanges, setHasChanges] = useState(false)
  // Permissions state
  const [roles, setRoles] = useState<Role[]>([])
  const [overwrites, setOverwrites] = useState<ChannelOverwrite[]>([])
  const [selectedOverwriteId, setSelectedOverwriteId] = useState<string | null>(null)
  const [showAddOverwrite, setShowAddOverwrite] = useState(false)
  const [newOverwriteType, setNewOverwriteType] = useState<'role' | 'member'>('role')
  const [newOverwriteTargetId, setNewOverwriteTargetId] = useState('')

  // Reveal animation for the overwrites list inside the Permissions section
  // (the SettingsShell handles the nav reveal independently).
  const isRevealing = useRevealAnimation(overwrites.length, [overwrites.length])

  // Load roles and overwrites
  useEffect(() => {
    api.getRoles(serverId).then(setRoles).catch(() => setRoles([]))
    api.getChannelOverwrites(channel.id).then(setOverwrites).catch(() => setOverwrites([]))
  }, [serverId, channel.id])

  const handleFieldChange = <K extends keyof ApiChannel>(field: K, value: ApiChannel[K]) => {
    setEditedChannel(prev => ({ ...prev, [field]: value }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    if (!hasChanges) return
    try {
      await api.updateChannel(channel.id, editedChannel)
      onUpdate(channel.id, editedChannel)
      setEditedChannel({})
      setHasChanges(false)
    } catch (err) {
      console.error('Failed to update channel:', err)
    }
  }

  const handleTogglePermission = async (overwriteId: string, permission: number, currentAllow: number, currentDeny: number) => {
    const overwrite = overwrites.find(o => o.id === overwriteId)
    if (!overwrite) return

    let newAllow = currentAllow
    let newDeny = currentDeny

    // Cycle: neutral -> allow -> deny -> neutral
    const isAllowed = (currentAllow & permission) !== 0
    const isDenied = (currentDeny & permission) !== 0

    if (!isAllowed && !isDenied) {
      newAllow |= permission
    } else if (isAllowed) {
      newAllow &= ~permission
      newDeny |= permission
    } else {
      newDeny &= ~permission
    }

    try {
      await api.upsertChannelOverwrite(channel.id, {
        target_type: overwrite.target_type,
        target_id: overwrite.target_id,
        allow: newAllow,
        deny: newDeny,
      })
      setOverwrites(prev => prev.map(o => o.id === overwriteId ? { ...o, allow: newAllow, deny: newDeny } : o))
    } catch (err) {
      console.error('Failed to update permission:', err)
    }
  }

  const handleAddOverwrite = async () => {
    if (!newOverwriteTargetId) return
    try {
      const result = await api.upsertChannelOverwrite(channel.id, {
        target_type: newOverwriteType,
        target_id: newOverwriteTargetId,
        allow: 0,
        deny: 0,
      })
      setOverwrites(prev => [...prev, result])
      setShowAddOverwrite(false)
      setNewOverwriteTargetId('')
    } catch (err) {
      console.error('Failed to add overwrite:', err)
    }
  }

  const handleDeleteOverwrite = async (overwrite: ChannelOverwrite) => {
    try {
      await api.deleteChannelOverwrite(channel.id, overwrite.target_type, overwrite.target_id)
      setOverwrites(prev => prev.filter(o => o.id !== overwrite.id))
    } catch (err) {
      console.error('Failed to delete overwrite:', err)
    }
  }

  const renderOverview = () => (
    <div className={s.section}>
      <div className={s.sectionHeader}>
        <h2 className="txt-medium txt-semibold">Channel Overview</h2>
      </div>

      <div className={s.field}>
        <label className={`${s.label} txt-tiny txt-semibold`}>CHANNEL NAME</label>
        <input
          type="text"
          className={s.input}
          value={editedChannel.name ?? channel.name}
          onChange={e => handleFieldChange('name', e.target.value)}
          disabled={!canManage || channel.is_system}
        />
      </div>

      <div className={s.field}>
        <label className={`${s.label} txt-tiny txt-semibold`}>CHANNEL TOPIC</label>
        <textarea
          className={s.textarea}
          value={editedChannel.topic ?? channel.topic ?? ''}
          onChange={e => handleFieldChange('topic', e.target.value)}
          placeholder="Let everyone know what this channel is about"
          disabled={!canManage || channel.is_system}
          rows={3}
        />
      </div>

      {channel.is_system && (
        <div className={s.systemNotice}>
          <Lock size={14} strokeWidth={1.5} />
          <span className="txt-small">This is a system channel and cannot be modified.</span>
        </div>
      )}

      <div className={s.toggleRow}>
        <div className={s.toggleInfo}>
          <span className="txt-small txt-semibold">NSFW Channel</span>
          <span className={`${s.toggleDesc} txt-tiny`}>Age-restricted content</span>
        </div>
        <label className={s.toggle}>
          <input
            type="checkbox"
            checked={editedChannel.is_nsfw ?? channel.is_nsfw ?? false}
            onChange={e => handleFieldChange('is_nsfw', e.target.checked)}
            disabled={!canManage || channel.is_system}
          />
          <span className={s.toggleSlider} />
        </label>
      </div>

      <div className={s.field}>
        <label className={`${s.label} txt-tiny txt-semibold`}>SLOWMODE (SECONDS)</label>
        <input
          type="number"
          className={s.input}
          value={editedChannel.slowmode_seconds ?? channel.slowmode_seconds ?? 0}
          onChange={e => handleFieldChange('slowmode_seconds', parseInt(e.target.value) || 0)}
          min={0}
          max={21600}
          disabled={!canManage || channel.is_system}
        />
        <span className={`${s.fieldHint} txt-tiny`}>Users can send one message per interval. 0 = disabled.</span>
      </div>

      {hasChanges && canManage && !channel.is_system && (
        <button className={s.saveBtn} onClick={handleSave}>
          <Save size={14} strokeWidth={1.5} />
          Save Changes
        </button>
      )}
    </div>
  )

  const renderPermissions = () => {
    const selectedOverwrite = selectedOverwriteId ? overwrites.find(o => o.id === selectedOverwriteId) : null

    return (
      <div className={s.section}>
        <div className={s.sectionHeader}>
          <h2 className="txt-medium txt-semibold">Channel Permissions</h2>
          {canManage && !channel.is_system && (
            <button className={s.addBtn} onClick={() => setShowAddOverwrite(true)}>
              <Plus size={14} strokeWidth={1.5} />
              Add Override
            </button>
          )}
        </div>

        {channel.is_system && (
          <div className={s.systemNotice}>
            <Lock size={14} strokeWidth={1.5} />
            <span className="txt-small">System channel permissions cannot be modified.</span>
          </div>
        )}

        <div className={s.permissionsLayout}>
          <div className={s.overwritesList}>
            <div className={s.overwritesHeader}>
              <span className="txt-tiny txt-semibold">ROLES / MEMBERS</span>
            </div>
            {overwrites.map((overwrite, idx) => {
              const role = roles.find(r => r.id === overwrite.target_id)
              const name = role?.name ?? overwrite.target_id
              const isSelected = selectedOverwriteId === overwrite.id
              return (
                <div
                  key={overwrite.id}
                  className={`${s.overwriteItem} ${isSelected ? s.selected : ''} ${isRevealing ? s.reveal : ''}`}
                  style={{ animationDelay: `${revealDelay(idx)}ms` }}
                  onClick={() => setSelectedOverwriteId(overwrite.id)}
                >
                  <Shield size={14} strokeWidth={1.5} />
                  <span className="txt-small">{name}</span>
                </div>
              )
            })}
          </div>

          {selectedOverwrite && (
            <div className={s.permissionsPanel}>
              <div className={s.permissionsPanelHeader}>
                <span className="txt-small txt-semibold">
                  {roles.find(r => r.id === selectedOverwrite.target_id)?.name ?? selectedOverwrite.target_id}
                </span>
                {canManage && !channel.is_system && (
                  <button
                    className={s.deleteOverwriteBtn}
                    onClick={() => handleDeleteOverwrite(selectedOverwrite)}
                    title="Remove override"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>

              <div className={s.permissionsList}>
                {P.CHANNEL_PERMISSION_LABELS.map(perm => {
                  const isAllowed = (selectedOverwrite.allow & perm.flag) !== 0
                  const isDenied = (selectedOverwrite.deny & perm.flag) !== 0
                  const state = isAllowed ? 'allow' : isDenied ? 'deny' : 'neutral'

                  return (
                    <div key={perm.key} className={s.permissionRow}>
                      <span className="txt-small">{perm.label}</span>
                      <button
                        className={`${s.permissionToggle} ${s[state]}`}
                        onClick={() => handleTogglePermission(selectedOverwrite.id, perm.flag, selectedOverwrite.allow, selectedOverwrite.deny)}
                        disabled={!canManage || channel.is_system}
                      >
                        {state === 'allow' && <Check size={12} strokeWidth={2} />}
                        {state === 'deny' && <XCircle size={12} strokeWidth={2} />}
                        {state === 'neutral' && <span className={s.neutralDash}>—</span>}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {showAddOverwrite && (
          <div className={s.addOverwriteModal}>
            <div className={s.addOverwriteContent}>
              <h3 className="txt-medium txt-semibold">Add Permission Override</h3>
              <div className={s.field}>
                <label className={`${s.label} txt-tiny txt-semibold`}>TYPE</label>
                <select
                  className={s.select}
                  value={newOverwriteType}
                  onChange={e => setNewOverwriteType(e.target.value as 'role' | 'member')}
                >
                  <option value="role">Role</option>
                  <option value="member">Member</option>
                </select>
              </div>
              <div className={s.field}>
                <label className={`${s.label} txt-tiny txt-semibold`}>
                  {newOverwriteType === 'role' ? 'ROLE' : 'MEMBER ID'}
                </label>
                {newOverwriteType === 'role' ? (
                  <select
                    className={s.select}
                    value={newOverwriteTargetId}
                    onChange={e => setNewOverwriteTargetId(e.target.value)}
                  >
                    <option value="">Select a role...</option>
                    {roles.map(role => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className={s.input}
                    value={newOverwriteTargetId}
                    onChange={e => setNewOverwriteTargetId(e.target.value)}
                    placeholder="Enter member ID"
                  />
                )}
              </div>
              <div className={s.addOverwriteActions}>
                <button className={s.cancelBtn} onClick={() => setShowAddOverwrite(false)}>
                  Cancel
                </button>
                <button className={s.addOverwriteBtn} onClick={handleAddOverwrite}>
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <SettingsShell
      section={section}
      onSection={setSection}
      onClose={onClose}
      navGroups={NAV}
      navHeader={
        <span className="txt-small txt-semibold">{channel.name}</span>
      }
    >
      {section === 'overview' && renderOverview()}
      {section === 'permissions' && renderPermissions()}
    </SettingsShell>
  )
}
