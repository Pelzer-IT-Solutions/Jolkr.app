/**
 * Roles management hook for the ServerSettings/RolesTab.
 *
 * Owns:
 *   - the roles list (fetched on mount, mutated by create/update/delete);
 *   - the editing snapshot for the currently selected role
 *     (id / name / color / permissions) plus an "originals" snapshot for
 *     change-detection and revert-on-cancel;
 *   - the selected role id (radio-button semantics: always exactly one
 *     selected, can't unselect).
 *
 * Side effect: deleting a role also strips the role id from every member's
 * `role_ids` array via the passed-in `setMembers` setter, matching the
 * pre-extraction inline behaviour.
 *
 * Returns everything RolesTab needs to render plus `roles` so ServerSettings
 * can show the role count in the nav.
 */
import { useEffect, useMemo, useState } from 'react'
import * as api from '../../api/client'
import type { Role, Member } from '../../api/types'

/** API returns roles by position DESC; UI shows oldest / lowest position first
 *  (new roles at the end). */
export function sortRolesByPosition(roles: Role[]): Role[] {
  return [...roles].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position
    return a.name.localeCompare(b.name)
  })
}

function colorToHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`
}

interface UseRoleEditArgs {
  serverId: string
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>
}

export function useRoleEdit({ serverId, setMembers }: UseRoleEditArgs) {
  const [roles, setRoles] = useState<Role[]>([])

  // Editing snapshot — always non-null while a role is selected
  const [editingRoleId,          setEditingRoleId]          = useState<string | null>(null)
  const [editingRoleName,        setEditingRoleName]        = useState('')
  const [editingRoleColor,       setEditingRoleColor]       = useState('#000000')
  const [editingRolePermissions, setEditingRolePermissions] = useState<number>(0)
  // Originals — snapshot for cancel + change-detection
  const [originalRoleName,        setOriginalRoleName]        = useState('')
  const [originalRoleColor,       setOriginalRoleColor]       = useState('#000000')
  const [originalRolePermissions, setOriginalRolePermissions] = useState<number>(0)
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)

  // Initial fetch — auto-select first role (oldest position, e.g. @everyone).
  useEffect(() => {
    api.getRoles(serverId).then((loadedRoles) => {
      setRoles(loadedRoles)
      const ordered = sortRolesByPosition(loadedRoles)
      if (ordered.length > 0) {
        const first = ordered[0]
        const colorHex = colorToHex(first.color)
        setSelectedRoleId(first.id)
        setEditingRoleId(first.id)
        setEditingRoleName(first.name)
        setEditingRoleColor(colorHex)
        setEditingRolePermissions(first.permissions)
        setOriginalRoleName(first.name)
        setOriginalRoleColor(colorHex)
        setOriginalRolePermissions(first.permissions)
      }
    }).catch(() => setRoles([]))
  }, [serverId])

  const rolesOrdered = useMemo(() => sortRolesByPosition(roles), [roles])

  const hasRoleChanges = !!editingRoleId && (
    editingRoleName        !== originalRoleName  ||
    editingRoleColor       !== originalRoleColor ||
    editingRolePermissions !== originalRolePermissions
  )

  function loadEditingFromRole(role: Role) {
    const colorHex = colorToHex(role.color)
    setEditingRoleId(role.id)
    setEditingRoleName(role.name)
    setEditingRoleColor(colorHex)
    setEditingRolePermissions(role.permissions)
    setOriginalRoleName(role.name)
    setOriginalRoleColor(colorHex)
    setOriginalRolePermissions(role.permissions)
  }

  const handleCreate = async () => {
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
      const newRole = await api.createRole(serverId, {
        name: defaultName,
        color: defaultColor,
        permissions: 0,
      })
      setRoles(prev => [...prev, newRole])
      setSelectedRoleId(newRole.id)
      loadEditingFromRole(newRole)
    } catch (e) { console.warn('Failed to create role:', e) }
  }

  const handleSelect = (roleId: string) => {
    // Radio-button: always exactly one selected; clicking the current does nothing.
    if (selectedRoleId === roleId) return
    setSelectedRoleId(roleId)
    const role = roles.find(r => r.id === roleId)
    if (role) loadEditingFromRole(role)
  }

  const handleDelete = async (roleId: string) => {
    try {
      await api.deleteRole(roleId)
      setRoles(prev => {
        const newRoles = prev.filter(r => r.id !== roleId)
        // If the deleted role was selected, switch to the new first role.
        if (selectedRoleId === roleId && newRoles.length > 0) {
          const next = sortRolesByPosition(newRoles)[0]
          setSelectedRoleId(next.id)
          loadEditingFromRole(next)
        }
        return newRoles
      })
      // Strip the deleted role from every member's role_ids.
      setMembers(prev => prev.map(m => ({
        ...m,
        role_ids: (m.role_ids ?? []).filter((id: string) => id !== roleId),
      })))
    } catch (e) { console.warn('Failed to delete role:', e) }
  }

  const handleSave = async () => {
    if (!editingRoleId || !editingRoleName.trim()) return
    try {
      const updated = await api.updateRole(editingRoleId, {
        name: editingRoleName.trim(),
        color: parseInt(editingRoleColor.replace('#', ''), 16),
        permissions: editingRolePermissions,
      })
      setRoles(prev => prev.map(r => r.id === editingRoleId ? updated : r))
      setOriginalRoleName(editingRoleName.trim())
      setOriginalRoleColor(editingRoleColor)
      setOriginalRolePermissions(editingRolePermissions)
    } catch (e) { console.warn('Failed to update role:', e) }
  }

  const handleCancel = () => {
    // Revert editing snapshot to originals (don't deselect).
    setEditingRoleName(originalRoleName)
    setEditingRoleColor(originalRoleColor)
    setEditingRolePermissions(originalRolePermissions)
  }

  const togglePermission = (flag: number) => {
    setEditingRolePermissions(prev => {
      const has = (prev & flag) === flag
      return has ? prev & ~flag : prev | flag
    })
  }

  const clearPermissions = () => setEditingRolePermissions(0)

  return {
    roles,
    rolesOrdered,
    selectedRoleId,
    editingRoleId,
    editingRoleName, setEditingRoleName,
    editingRoleColor, setEditingRoleColor,
    editingRolePermissions,
    hasRoleChanges,
    handleCreate,
    handleSelect,
    handleDelete,
    handleSave,
    handleCancel,
    togglePermission,
    clearPermissions,
  }
}
