import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useServersStore } from '../../../stores/servers';
import type { Server, Role } from '../../../api/types';
import { PERMISSION_LABELS } from '../../../utils/permissions';
import Input from '../../ui/Input';
import Button from '../../ui/Button';
import ConfirmDialog from '../ConfirmDialog';

export interface RolesTabProps {
  server: Server;
}

export default function RolesTab({ server }: RolesTabProps) {
  const roles = useServersStore((s) => s.roles);
  const fetchRoles = useServersStore((s) => s.fetchRoles);
  const createRole = useServersStore((s) => s.createRole);
  const updateRole = useServersStore((s) => s.updateRole);
  const deleteRole = useServersStore((s) => s.deleteRole);
  const serverRoles = roles[server.id] ?? [];
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRoles(server.id);
  }, [server.id, fetchRoles]);

  const selectedRole = serverRoles.find((r) => r.id === selectedRoleId);

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return;
    try {
      const role = await createRole(server.id, { name: newRoleName.trim() });
      setNewRoleName('');
      setShowCreateRole(false);
      setSelectedRoleId(role.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 h-full">
      {error && <div className="absolute top-0 left-0 right-0 bg-danger/10 text-danger text-sm p-2 rounded-lg">{error}</div>}

      {/* Roles sidebar */}
      <div className="w-40 shrink-0 border-r border-divider px-3 py-4 flex flex-col gap-1">
        <div className="space-y-0.5">
          {serverRoles.map((role) => (
            <button
              key={role.id}
              onClick={() => setSelectedRoleId(role.id)}
              className={`w-full rounded-md px-2.5 py-2 text-left text-sm flex items-center gap-2 ${
                selectedRoleId === role.id
                  ? 'bg-active text-text-primary'
                  : 'text-text-secondary hover:bg-hover hover:text-text-primary'
              }`}
            >
              {role.color !== 0 && (
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: `#${role.color.toString(16).padStart(6, '0')}` }}
                />
              )}
              <span className="truncate">{role.name}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowCreateRole(true)}
          className="w-full mt-2 px-2.5 py-2 text-sm font-medium text-accent hover:text-accent-hover text-left flex items-center gap-1.5"
        >
          <Plus className="size-3.5" />
          Create Role
        </button>
        {showCreateRole && (
          <div className="mt-1">
            <Input
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="Role name"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateRole()}
            />
            <div className="flex gap-1 mt-1">
              <button onClick={handleCreateRole} className="text-xs text-accent">Create</button>
              <button onClick={() => setShowCreateRole(false)} className="text-xs text-text-tertiary">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Role editor */}
      <div className="flex-1 min-w-0 px-5 py-4 flex flex-col gap-4 overflow-y-auto">
        {selectedRole ? (
          <RoleEditor
            key={selectedRole.id}
            role={selectedRole}
            serverId={server.id}
            onUpdate={updateRole}
            onDelete={deleteRole}
            onError={setError}
          />
        ) : (
          <div className="text-text-tertiary text-sm py-4">Select a role to edit its permissions.</div>
        )}
      </div>
    </div>
  );
}

function RoleEditor({
  role,
  serverId,
  onUpdate,
  onDelete,
  onError,
}: {
  role: Role;
  serverId: string;
  onUpdate: (id: string, serverId: string, body: { name?: string; color?: number; permissions?: number }) => Promise<Role>;
  onDelete: (id: string, serverId: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(`#${role.color.toString(16).padStart(6, '0')}`);
  const [perms, setPerms] = useState(role.permissions);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const togglePerm = (flag: number) => {
    if (perms & flag) {
      setPerms(perms & ~flag);
    } else {
      setPerms(perms | flag);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(role.id, serverId, {
        name: name.trim() || undefined,
        color: parseInt(color.replace('#', ''), 16) || 0,
        permissions: perms,
      });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      await onDelete(role.id, serverId);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // Group permissions by category
  const permGroups: Record<string, typeof PERMISSION_LABELS> = {};
  for (const p of PERMISSION_LABELS) {
    if (!permGroups[p.category]) permGroups[p.category] = [];
    permGroups[p.category].push(p);
  }

  return (
    <div>
      <div className="flex gap-3 mb-4">
        <div className="flex-1">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={role.is_default}
          />
        </div>
        <div className="w-20 flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-full h-11 bg-bg border border-divider rounded-lg cursor-pointer"
          />
        </div>
      </div>

      <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">Permissions</div>
      <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto pr-1">
        {Object.entries(permGroups).map(([category, items], idx) => (
          <div key={category}>
            {idx > 0 && <div className="h-px bg-divider my-2" />}
            {items.map((p) => (
              <label key={p.key} className="flex items-center gap-2 py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(perms & p.flag) !== 0}
                  onChange={() => togglePerm(p.flag)}
                  className="w-4 h-4 rounded accent-primary"
                />
                <span className="text-sm text-text-primary">{p.label}</span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center mt-4 pt-4 border-t border-divider">
        {!role.is_default && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-sm text-danger hover:text-danger/80"
          >
            Delete Role
          </button>
        )}
        <div className="flex-1" />
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Role"
          message={`Are you sure you want to delete "${role.name}"? Members with this role will lose its permissions.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
