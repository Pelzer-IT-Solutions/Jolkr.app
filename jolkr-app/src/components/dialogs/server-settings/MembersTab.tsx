import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import SearchInput from '../../ui/SearchInput';
import EmptyState from '../../ui/EmptyState';
import { Users } from 'lucide-react';
import { useServersStore } from '../../../stores/servers';
import * as api from '../../../api/client';
import type { Server, Role, User } from '../../../api/types';
import Avatar from '../../Avatar';
import { hashColor } from '../../../adapters/transforms';

export interface MembersTabProps {
  server: Server;
}

export default function MembersTab({ server }: MembersTabProps) {
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
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rolePopover) return;
    function handleMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setRolePopover(null);
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setRolePopover(null); }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [rolePopover]);
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
      {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg mb-3">{error}</div>}

      {/* Search */}
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search members..."
        className="mb-3"
      />

      <div className="space-y-0 max-h-100 overflow-y-auto">
        {filteredMembers.map((m) => {
          const user = users[m.user_id];
          const memberRoles = (m.role_ids ?? []).map((id) => roleMap[id]).filter((r): r is Role => !!r && !r.is_default);
          const isPopoverOpen = rolePopover === m.user_id;

          return (
            <div key={m.id} className="px-1 py-3 flex justify-between items-center border-b border-border-subtle">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={32} userId={m.user_id} color={hashColor(m.user_id)} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">
                    {m.nickname ?? user?.username ?? m.user_id.slice(0, 8)}
                  </div>
                  <div className="flex gap-1 flex-wrap mt-0.5">
                    {memberRoles.map((r) => (
                      <span
                        key={r.id}
                        className="text-xs font-medium text-text-tertiary"
                      >
                        {r.name}
                      </span>
                    ))}
                  </div>
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
                  className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary bg-hover hover:bg-hover rounded"
                >
                  Roles
                </button>
                {isPopoverOpen && popoverPos && (
                    <div
                      ref={popoverRef}
                      className="fixed z-[70] bg-surface border border-divider rounded-lg shadow-xl py-1 min-w-45 max-h-50 overflow-y-auto"
                      style={{ top: popoverPos.top, left: popoverPos.left }}
                    >
                      {assignableRoles.length === 0 && (
                        <div className="px-3 py-2 text-xs text-text-tertiary">No roles to assign</div>
                      )}
                      {assignableRoles.map((role) => {
                        const has = (m.role_ids ?? []).includes(role.id);
                        return (
                          <button
                            key={role.id}
                            onClick={() => handleToggleRole(m.user_id, role.id, has)}
                            disabled={saving}
                            className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-hover disabled:opacity-50"
                          >
                            <input
                              type="checkbox"
                              checked={has}
                              readOnly
                              className="w-3.5 h-3.5 rounded accent-primary pointer-events-none"
                            />
                            {role.color !== 0 && (
                              <span
                                className="size-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: `#${role.color.toString(16).padStart(6, '0')}` }}
                              />
                            )}
                            <span className="text-text-secondary truncate">{role.name}</span>
                          </button>
                        );
                      })}
                    </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredMembers.length === 0 && (
          <EmptyState icon={<Users className="size-8" />} title={search ? 'No members found' : 'No members'} />
        )}
      </div>
    </div>
  );
}
