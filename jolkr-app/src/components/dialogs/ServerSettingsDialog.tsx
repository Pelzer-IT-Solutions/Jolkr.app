import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServersStore } from '../../stores/servers';
import { useAuthStore } from '../../stores/auth';
import * as api from '../../api/client';
import { rewriteStorageUrl } from '../../platform/config';
import type { Server, Role, Ban, User, ServerEmoji, AuditLogEntry } from '../../api/types';
import { PERMISSION_LABELS, hasPermission, BAN_MEMBERS, MANAGE_ROLES, MANAGE_SERVER } from '../../utils/permissions';
import ConfirmDialog from './ConfirmDialog';
import Avatar from '../Avatar';

interface Props {
  server: Server;
  onClose: () => void;
}

type Tab = 'general' | 'roles' | 'members' | 'bans' | 'emojis' | 'audit-log';

export default function ServerSettingsDialog({ server, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general');
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.id === server.owner_id;
  const myPermsRaw = useServersStore((s) => s.permissions[server.id]);
  const myPerms = myPermsRaw ?? 0;
  const fetchPermissions = useServersStore((s) => s.fetchPermissions);

  // Owner always has full access; for non-owners, derive from loaded permissions
  const canBan = isOwner || hasPermission(myPerms, BAN_MEMBERS);
  const canManageRoles = isOwner || hasPermission(myPerms, MANAGE_ROLES);
  const canManageServer = isOwner || hasPermission(myPerms, MANAGE_SERVER);

  useEffect(() => {
    fetchPermissions(server.id);
  }, [server.id, fetchPermissions]);

  // Escape key handler for dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabs: Tab[] = ['general', 'roles'];
  if (canManageRoles) tabs.push('members');
  if (canBan) tabs.push('bans');
  if (canManageServer) tabs.push('emojis');
  if (canManageServer) tabs.push('audit-log');

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="bg-surface rounded-lg w-[560px] max-w-[95vw] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Tabs */}
        <div className="flex border-b border-divider shrink-0">
          <div className="flex-1 flex overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                  tab === t
                    ? 'text-text-primary border-b-2 border-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t === 'audit-log' ? 'Audit Log' : t}
              </button>
            ))}
          </div>
          <button onClick={onClose} aria-label="Close" className="px-3 py-3 text-text-muted hover:text-text-primary shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'general' && <GeneralTab server={server} onClose={onClose} isOwner={isOwner} />}
          {tab === 'roles' && <RolesTab server={server} />}
          {tab === 'members' && <MembersTab server={server} />}
          {tab === 'bans' && <BansTab server={server} />}
          {tab === 'emojis' && <EmojisTab server={server} />}
          {tab === 'audit-log' && <AuditLogTab server={server} />}
        </div>
      </div>
    </div>
  );
}

function GeneralTab({ server, onClose, isOwner }: { server: Server; onClose: () => void; isOwner: boolean }) {
  const navigate = useNavigate();
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description ?? '');
  const [iconUrl, setIconUrl] = useState(server.icon_url ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateServer = useServersStore((s) => s.updateServer);
  const deleteServer = useServersStore((s) => s.deleteServer);

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.uploadFile(file);
      setIconUrl(result.key);
    } catch { setError('Failed to upload icon'); }
    setUploading(false);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Server name is required');
      return;
    }
    setSaving(true);
    try {
      await updateServer(server.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        icon_url: iconUrl || undefined,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      await deleteServer(server.id);
      onClose();
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{error}</div>}

      {/* Server icon */}
      <div className="flex items-center gap-4 mb-4">
        <div
          className="w-16 h-16 rounded-2xl bg-input flex items-center justify-center relative group cursor-pointer shrink-0 overflow-hidden"
          onClick={() => fileInputRef.current?.click()}
        >
          {iconUrl ? (
            <img src={rewriteStorageUrl(iconUrl) ?? iconUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-text-muted text-lg font-bold">{name.slice(0, 2).toUpperCase()}</span>
          )}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            {uploading ? (
              <span className="text-white text-[10px]">...</span>
            ) : (
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </div>
        </div>
        <div className="text-xs text-text-muted">
          Click to upload server icon<br />Recommended: 128x128px
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconUpload} />
      </div>

      <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Server Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm mb-4"
        autoFocus
      />

      <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm resize-none mb-4"
        rows={3}
        placeholder="What's this server about?"
      />

      <div className="flex justify-end gap-2 mb-6">
        <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Danger zone — only owner can delete */}
      {isOwner && (
        <div className="border border-error/30 rounded-lg p-4">
          <h4 className="text-error font-semibold text-sm mb-1">Danger Zone</h4>
          <p className="text-text-muted text-xs mb-3">
            Deleting a server is permanent and cannot be undone. All channels and messages will be lost.
          </p>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 bg-error hover:bg-error/80 text-white text-sm rounded"
          >
            Delete Server
          </button>
        </div>
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Server"
          message={`Are you sure you want to delete "${server.name}"? This action is permanent and cannot be undone.`}
          confirmLabel="Delete Server"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}

function RolesTab({ server }: { server: Server }) {
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
    <div>
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{error}</div>}

      <div className="flex gap-4">
        {/* Role list */}
        <div className="w-[160px] shrink-0">
          <div className="text-[11px] font-bold text-text-secondary uppercase tracking-wider mb-2">Roles</div>
          <div className="space-y-0.5">
            {serverRoles.map((role) => (
              <button
                key={role.id}
                onClick={() => setSelectedRoleId(role.id)}
                className={`w-full px-2 py-1.5 rounded text-left text-sm flex items-center gap-1.5 ${
                  selectedRoleId === role.id
                    ? 'bg-primary/10 text-text-primary'
                    : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
                }`}
              >
                {role.color !== 0 && (
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: `#${role.color.toString(16).padStart(6, '0')}` }}
                  />
                )}
                <span className="truncate">{role.name}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCreateRole(true)}
            className="w-full mt-2 px-2 py-1.5 text-sm text-primary hover:text-primary-hover text-left"
          >
            + Create Role
          </button>
          {showCreateRole && (
            <div className="mt-1">
              <input
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="Role name"
                className="w-full px-2 py-1 bg-input rounded text-text-primary text-sm"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateRole()}
              />
              <div className="flex gap-1 mt-1">
                <button onClick={handleCreateRole} className="text-xs text-primary">Create</button>
                <button onClick={() => setShowCreateRole(false)} className="text-xs text-text-muted">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Role editor */}
        <div className="flex-1 min-w-0">
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
            <div className="text-text-muted text-sm py-4">Select a role to edit its permissions.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function BansTab({ server }: { server: Server }) {
  const [bans, setBans] = useState<Ban[]>([]);
  const [banUsers, setBanUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [unbanning, setUnbanning] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getBans(server.id).then((data) => {
      if (cancelled) return;
      setBans(data);
      // Deduplicate user IDs to fetch
      const userIds = new Set<string>();
      for (const ban of data) {
        userIds.add(ban.user_id);
        if (ban.banned_by) userIds.add(ban.banned_by);
      }
      userIds.forEach((id) => {
        api.getUser(id).then((u) => {
          if (!cancelled) setBanUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {});
      });
    }).catch((e) => {
      if (!cancelled) setError((e as Error).message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [server.id]);

  const handleUnban = async (userId: string) => {
    setUnbanning(userId);
    setError('');
    try {
      await api.unbanMember(server.id, userId);
      setBans((prev) => prev.filter((b) => b.user_id !== userId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUnbanning(null);
    }
  };

  if (loading) {
    return <div className="text-text-muted text-sm py-4">Loading bans...</div>;
  }

  return (
    <div>
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{error}</div>}

      {bans.length === 0 ? (
        <div className="text-text-muted text-sm py-4">No banned users.</div>
      ) : (
        <div className="space-y-2">
          {bans.map((ban) => {
            const user = banUsers[ban.user_id];
            const bannedByUser = ban.banned_by ? banUsers[ban.banned_by] : null;
            return (
              <div key={ban.id} className="flex items-center gap-3 p-3 bg-input rounded-lg">
                <div className="w-8 h-8 rounded-full bg-error/20 flex items-center justify-center shrink-0">
                  <span className="text-error text-xs font-bold">
                    {(user?.username ?? '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-sm font-medium truncate">
                    {user?.username ?? ban.user_id.slice(0, 8)}
                  </div>
                  <div className="text-text-muted text-[11px]">
                    {ban.reason && <span className="text-text-secondary">{ban.reason} — </span>}
                    Banned by {bannedByUser?.username ?? 'unknown'} on{' '}
                    {new Date(ban.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleUnban(ban.user_id)}
                  disabled={unbanning === ban.user_id}
                  className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary bg-white/5 hover:bg-white/10 rounded shrink-0 disabled:opacity-50"
                >
                  {unbanning === ban.user_id ? '...' : 'Unban'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MembersTab({ server }: { server: Server }) {
  const members = useServersStore((s) => s.members);
  const roles = useServersStore((s) => s.roles);
  const fetchMembersWithRoles = useServersStore((s) => s.fetchMembersWithRoles);
  const fetchRoles = useServersStore((s) => s.fetchRoles);
  const serverMembers = members[server.id] ?? [];
  const serverRoles = roles[server.id] ?? [];
  const [users, setUsers] = useState<Record<string, User>>({});
  const [search, setSearch] = useState('');
  const [rolePopover, setRolePopover] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fetchedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    fetchMembersWithRoles(server.id).catch(() => {});
    fetchRoles(server.id).catch(() => {});
  }, [server.id, fetchMembersWithRoles, fetchRoles]);

  // Fetch user details for all members
  useEffect(() => {
    serverMembers.forEach((m) => {
      if (!fetchedIdsRef.current.has(m.user_id)) {
        fetchedIdsRef.current.add(m.user_id);
        api.getUser(m.user_id).then((u) => {
          setUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {});
      }
    });
  }, [serverMembers]);

  const assignableRoles = useMemo(() =>
    serverRoles.filter((r) => !r.is_default),
    [serverRoles]
  );

  const roleMap = useMemo(() => {
    const map: Record<string, Role> = {};
    for (const r of serverRoles) map[r.id] = r;
    return map;
  }, [serverRoles]);

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return serverMembers;
    const q = search.toLowerCase();
    return serverMembers.filter((m) => {
      const user = users[m.user_id];
      const name = m.nickname ?? user?.username ?? '';
      return name.toLowerCase().includes(q);
    });
  }, [serverMembers, search, users]);

  const handleToggleRole = useCallback(async (userId: string, roleId: string, hasRole: boolean) => {
    setSaving(true);
    setError('');
    try {
      if (hasRole) {
        await api.removeRole(server.id, roleId, userId);
      } else {
        await api.assignRole(server.id, roleId, userId);
      }
      await fetchMembersWithRoles(server.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [server.id, fetchMembersWithRoles]);

  return (
    <div>
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{error}</div>}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search members..."
        className="w-full px-3 py-2 bg-input rounded text-text-primary text-sm mb-3"
      />

      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {filteredMembers.map((m) => {
          const user = users[m.user_id];
          const memberRoles = (m.role_ids ?? []).map((id) => roleMap[id]).filter((r): r is Role => !!r && !r.is_default);
          const isPopoverOpen = rolePopover === m.user_id;

          return (
            <div key={m.id} className="flex items-center gap-2 p-2 rounded hover:bg-white/5">
              <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={32} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">
                  {m.nickname ?? user?.username ?? m.user_id.slice(0, 8)}
                </div>
                <div className="flex gap-1 flex-wrap mt-0.5">
                  {memberRoles.map((r) => (
                    <span
                      key={r.id}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: r.color ? `#${r.color.toString(16).padStart(6, '0')}20` : 'rgba(255,255,255,0.05)',
                        color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : undefined,
                      }}
                    >
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <button
                  onClick={(e) => {
                    if (isPopoverOpen) { setRolePopover(null); return; }
                    const rect = e.currentTarget.getBoundingClientRect();
                    const spaceBelow = window.innerHeight - rect.bottom;
                    const top = spaceBelow < 220 ? rect.top - 210 : rect.bottom + 4;
                    setPopoverPos({ top, left: rect.right - 180 });
                    setRolePopover(m.user_id);
                  }}
                  className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary bg-white/5 hover:bg-white/10 rounded"
                >
                  Roles
                </button>
                {isPopoverOpen && popoverPos && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setRolePopover(null)} />
                    <div
                      className="fixed z-[70] bg-surface border border-divider rounded-lg shadow-xl py-1 min-w-[180px] max-h-[200px] overflow-y-auto"
                      style={{ top: popoverPos.top, left: popoverPos.left }}
                    >
                      {assignableRoles.length === 0 && (
                        <div className="px-3 py-2 text-xs text-text-muted">No roles to assign</div>
                      )}
                      {assignableRoles.map((role) => {
                        const has = (m.role_ids ?? []).includes(role.id);
                        return (
                          <button
                            key={role.id}
                            onClick={() => handleToggleRole(m.user_id, role.id, has)}
                            disabled={saving}
                            className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-white/5 disabled:opacity-50"
                          >
                            <input
                              type="checkbox"
                              checked={has}
                              readOnly
                              className="w-3.5 h-3.5 rounded accent-primary pointer-events-none"
                            />
                            {role.color !== 0 && (
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: `#${role.color.toString(16).padStart(6, '0')}` }}
                              />
                            )}
                            <span className="text-text-secondary truncate">{role.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {filteredMembers.length === 0 && (
          <div className="text-text-muted text-sm py-4 text-center">
            {search ? 'No members found' : 'No members'}
          </div>
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
          <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
            disabled={role.is_default}
          />
        </div>
        <div className="w-20">
          <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-full mt-1 h-[38px] bg-input rounded cursor-pointer"
          />
        </div>
      </div>

      <div className="text-[11px] font-bold text-text-secondary uppercase tracking-wider mb-2">Permissions</div>
      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
        {Object.entries(permGroups).map(([category, items]) => (
          <div key={category}>
            <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">{category}</div>
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
            className="text-sm text-error hover:text-error/80"
          >
            Delete Role
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
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

const MAX_EMOJIS = 50;

function EmojisTab({ server }: { server: Server }) {
  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  const [emojiUsers, setEmojiUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetchedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getServerEmojis(server.id).then((data) => {
      if (cancelled) return;
      setEmojis(data);
      const userIds = new Set<string>();
      for (const e of data) userIds.add(e.uploader_id);
      userIds.forEach((id) => {
        if (!fetchedIdsRef.current.has(id)) {
          fetchedIdsRef.current.add(id);
          api.getUser(id).then((u) => {
            if (!cancelled) setEmojiUsers((prev) => ({ ...prev, [u.id]: u }));
          }).catch(() => {});
        }
      });
    }).catch((e) => {
      if (!cancelled) setError((e as Error).message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [server.id]);

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !name.trim()) return;
    if (!/^[a-zA-Z0-9_]+$/.test(name.trim())) {
      setError('Emoji name can only contain letters, numbers, and underscores');
      return;
    }
    if (emojis.length >= MAX_EMOJIS) {
      setError(`Maximum of ${MAX_EMOJIS} emojis per server`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const emoji = await api.uploadEmoji(server.id, name.trim(), file);
      setEmojis((prev) => [...prev, emoji]);
      setName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!fetchedIdsRef.current.has(emoji.uploader_id)) {
        fetchedIdsRef.current.add(emoji.uploader_id);
        api.getUser(emoji.uploader_id).then((u) => {
          setEmojiUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (emojiId: string) => {
    setDeleting(emojiId);
    setError('');
    try {
      await api.deleteEmoji(emojiId);
      setEmojis((prev) => prev.filter((e) => e.id !== emojiId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return <div className="text-text-muted text-sm py-4">Loading emojis...</div>;
  }

  return (
    <div>
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{error}</div>}

      <div className="text-text-secondary text-xs mb-3">
        {emojis.length} / {MAX_EMOJIS} emojis
      </div>

      {/* Upload form */}
      <div className="flex items-end gap-2 mb-4 p-3 bg-input rounded-lg">
        <div className="flex-1">
          <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Emoji Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_emoji"
            className="w-full mt-1 px-3 py-2 bg-surface rounded text-text-primary text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Image</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="w-full mt-1 text-text-primary text-sm file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-surface file:text-text-secondary file:cursor-pointer"
          />
        </div>
        <button
          onClick={handleUpload}
          disabled={uploading || !name.trim()}
          className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50 shrink-0"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      {/* Emoji list */}
      {emojis.length === 0 ? (
        <div className="text-text-muted text-sm py-4">No custom emojis yet.</div>
      ) : (
        <div className="space-y-1">
          {emojis.map((emoji) => {
            const uploader = emojiUsers[emoji.uploader_id];
            return (
              <div key={emoji.id} className="flex items-center gap-3 p-2 rounded hover:bg-white/5">
                <img
                  src={rewriteStorageUrl(emoji.image_url) ?? emoji.image_url}
                  alt={emoji.name}
                  className="w-8 h-8 object-contain shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-sm font-medium truncate">:{emoji.name}:</div>
                  <div className="text-text-muted text-[11px]">
                    Uploaded by {uploader?.username ?? 'unknown'}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(emoji.id)}
                  disabled={deleting === emoji.id}
                  className="px-3 py-1 text-xs text-error hover:text-error/80 bg-white/5 hover:bg-white/10 rounded shrink-0 disabled:opacity-50"
                >
                  {deleting === emoji.id ? '...' : 'Delete'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  member_kick: 'Kicked member',
  member_ban: 'Banned member',
  member_unban: 'Unbanned member',
  channel_create: 'Created channel',
  channel_delete: 'Deleted channel',
  role_create: 'Created role',
  role_update: 'Updated role',
  role_delete: 'Deleted role',
};

const AUDIT_PAGE_SIZE = 25;

function AuditLogTab({ server }: { server: Server }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [error, setError] = useState('');
  const fetchedIdsRef = useRef(new Set<string>());

  const fetchUsers = useCallback((newEntries: AuditLogEntry[]) => {
    const ids = new Set<string>();
    for (const e of newEntries) {
      ids.add(e.user_id);
      if (e.target_id && e.target_type === 'user') ids.add(e.target_id);
    }
    ids.forEach((id) => {
      if (!fetchedIdsRef.current.has(id)) {
        fetchedIdsRef.current.add(id);
        api.getUser(id).then((u) => {
          setUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {});
      }
    });
  }, []);

  const loadEntries = useCallback(async (before?: string) => {
    const params: { action?: string; limit?: number; before?: string } = {
      limit: AUDIT_PAGE_SIZE,
    };
    if (actionFilter) params.action = actionFilter;
    if (before) params.before = before;

    const data = await api.getAuditLog(server.id, params);
    setHasMore(data.length >= AUDIT_PAGE_SIZE);
    fetchUsers(data);
    return data;
  }, [server.id, actionFilter, fetchUsers]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setEntries([]);
    fetchedIdsRef.current.clear();
    loadEntries().then((data) => {
      if (!cancelled) setEntries(data);
    }).catch((e) => {
      if (!cancelled) setError((e as Error).message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadEntries]);

  const handleLoadMore = async () => {
    if (entries.length === 0) return;
    setLoadingMore(true);
    setError('');
    try {
      const lastEntry = entries[entries.length - 1];
      const data = await loadEntries(lastEntry.id);
      setEntries((prev) => [...prev, ...data]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const formatTimestamp = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div>
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{error}</div>}

      {/* Filter */}
      <div className="mb-3">
        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Filter by action</label>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
        >
          <option value="">All actions</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-text-muted text-sm py-4">Loading audit log...</div>
      ) : entries.length === 0 ? (
        <div className="text-text-muted text-sm py-4">No audit log entries found.</div>
      ) : (
        <>
          <div className="space-y-1">
            {entries.map((entry) => {
              const user = users[entry.user_id];
              const targetUser = entry.target_id && entry.target_type === 'user' ? users[entry.target_id] : null;
              const actionLabel = AUDIT_ACTION_LABELS[entry.action_type] ?? entry.action_type;
              const targetDisplay = targetUser
                ? targetUser.username
                : entry.target_id
                  ? entry.target_id.slice(0, 8)
                  : null;

              return (
                <div key={entry.id} className="flex items-start gap-3 p-2 rounded hover:bg-white/5">
                  <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-primary">
                      <span className="font-medium">{user?.username ?? entry.user_id.slice(0, 8)}</span>
                      {' '}
                      <span className="text-text-secondary">{actionLabel}</span>
                      {targetDisplay && (
                        <>
                          {' '}
                          <span className="font-medium">{targetDisplay}</span>
                        </>
                      )}
                    </div>
                    {entry.reason && (
                      <div className="text-text-muted text-[11px] mt-0.5">Reason: {entry.reason}</div>
                    )}
                    <div className="text-text-muted text-[11px] mt-0.5">
                      {formatTimestamp(entry.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div className="mt-3 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-4 py-2 text-sm text-primary hover:text-primary-hover disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
