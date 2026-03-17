import { useCallback, useEffect, useState, useMemo } from 'react';
import { useServersStore, selectMyPermissions } from '../stores/servers';
import { usePresenceStore } from '../stores/presence';
import { useAuthStore } from '../stores/auth';
import * as api from '../api/client';
import type { User, Role } from '../api/types';
import { hasPermission, KICK_MEMBERS, BAN_MEMBERS, MANAGE_NICKNAMES, MANAGE_ROLES, MODERATE_MEMBERS } from '../utils/permissions';
import UserProfileCard from './UserProfileCard';
import MemberItem from './MemberItem';
import ConfirmDialog from './dialogs/ConfirmDialog';
import { useContextMenuStore } from '../stores/context-menu';

export interface MemberListProps {
  serverId: string;
  className?: string;
}

/** Convert integer color to hex string */
function colorToHex(color: number | undefined | null): string | undefined {
  if (color == null) return undefined;
  return `#${color.toString(16).padStart(6, '0')}`;
}

export default function MemberList({ serverId, className }: MemberListProps) {
  const currentUser = useAuthStore((s) => s.user);
  const members = useServersStore((s) => s.members);
  const fetchMembersWithRoles = useServersStore((s) => s.fetchMembersWithRoles);
  const roles = useServersStore((s) => s.roles);
  const fetchRoles = useServersStore((s) => s.fetchRoles);
  const myPerms = useServersStore(selectMyPermissions(serverId));
  const fetchPermissions = useServersStore((s) => s.fetchPermissions);
  const ownerId = useServersStore((s) => s.servers.find((srv) => srv.id === serverId)?.owner_id);
  const statuses = usePresenceStore((s) => s.statuses);
  const setBulk = usePresenceStore((s) => s.setBulk);
  const serverMembers = members[serverId] ?? [];
  const serverRoles = roles[serverId] ?? [];
  const [users, setUsers] = useState<Record<string, User>>({});
  const [profileTarget, setProfileTarget] = useState<{ userId: string; anchor: { x: number; y: number } } | null>(null);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState(false);

  // Dialog states (moved from MemberContextMenu)
  const [kickTarget, setKickTarget] = useState<{ userId: string; username: string } | null>(null);
  const [banTarget, setBanTarget] = useState<{ userId: string; username: string } | null>(null);
  const [banReason, setBanReason] = useState('');
  const [nicknameTarget, setNicknameTarget] = useState<{ userId: string; username: string } | null>(null);
  const [nicknameValue, setNicknameValue] = useState('');
  const [timeoutTarget, setTimeoutTarget] = useState<{ userId: string; username: string; isTimedOut: boolean; timeoutUntil?: string | null } | null>(null);
  const [roleTarget, setRoleTarget] = useState<{ userId: string; username: string; memberRoleIds: string[] } | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const isOwner = currentUser?.id === ownerId;
  const canKick = isOwner || hasPermission(myPerms, KICK_MEMBERS);
  const canBan = isOwner || hasPermission(myPerms, BAN_MEMBERS);
  const canManageNicknames = isOwner || hasPermission(myPerms, MANAGE_NICKNAMES);
  const canManageRoles = isOwner || hasPermission(myPerms, MANAGE_ROLES);
  const canTimeout = isOwner || hasPermission(myPerms, MODERATE_MEMBERS);

  // Build a role lookup map
  const roleMap = useMemo(() => {
    const map: Record<string, Role> = {};
    for (const r of serverRoles) map[r.id] = r;
    return map;
  }, [serverRoles]);

  // Clear actionError on server switch
  useEffect(() => {
    setActionError('');
  }, [serverId]);

  useEffect(() => {
    let cancelled = false;

    setLoadError(false);
    Promise.all([
      fetchMembersWithRoles(serverId),
      fetchRoles(serverId),
      fetchPermissions(serverId),
    ]).then(() => {
      if (cancelled) return;
      const mems = useServersStore.getState().members[serverId] ?? [];
      const ids = mems.map((m) => m.user_id);

      if (ids.length > 0) {
        api.getUsersBatch(ids).then((fetchedUsers) => {
          if (cancelled) return;
          const map: Record<string, User> = {};
          for (const u of fetchedUsers) map[u.id] = u;
          setUsers(map);
        }).catch(() => {
          Promise.all(ids.map((id) => api.getUser(id).catch(() => null))).then((results) => {
            if (cancelled) return;
            const map: Record<string, User> = {};
            for (const u of results) if (u) map[u.id] = u;
            setUsers(map);
          });
        });

        api.queryPresence(ids).then((result) => {
          if (!cancelled && result) setBulk(result);
        }).catch(() => {});
      }
    }).catch(() => { if (!cancelled) setLoadError(true); });

    return () => { cancelled = true; };
  }, [serverId, fetchMembersWithRoles, fetchRoles, fetchPermissions, setBulk]);

  const getName = useCallback((userId: string, nickname?: string | null) =>
    nickname ?? users[userId]?.username ?? 'Unknown', [users]);

  /** Get the highest-positioned role for a member (for display color) */
  const getTopRole = useCallback((roleIds?: string[]): Role | undefined => {
    if (!roleIds || roleIds.length === 0) return undefined;
    const memberRoles = roleIds
      .map((id) => roleMap[id])
      .filter((r): r is Role => !!r && !r.is_default)
      .sort((a, b) => b.position - a.position);
    return memberRoles[0];
  }, [roleMap]);

  const openProfile = useCallback((userId: string, e: React.MouseEvent) => {
    setProfileTarget({ userId, anchor: { x: e.clientX, y: e.clientY } });
  }, []);

  const handleContextMenu = useCallback((userId: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (userId === currentUser?.id) return;
    if (userId === ownerId) return;
    if (!canKick && !canBan && !canManageNicknames && !canManageRoles && !canTimeout) return;

    const member = (useServersStore.getState().members[serverId] ?? []).find((m) => m.user_id === userId);
    if (!member) return;
    const username = getName(userId, member.nickname);
    const isTimedOut = member.timeout_until != null && new Date(member.timeout_until) > new Date();

    const items: import('../stores/context-menu').ContextMenuEntry[] = [];

    if (canManageRoles) {
      items.push({
        label: 'Manage Roles', icon: 'Shield',
        onClick: () => setRoleTarget({ userId, username, memberRoleIds: member.role_ids ?? [] }),
      });
    }
    if (canManageNicknames) {
      items.push({
        label: 'Change Nickname', icon: 'PenLine',
        onClick: () => { setNicknameValue(member.nickname ?? ''); setNicknameTarget({ userId, username }); },
      });
    }
    if (canTimeout) {
      items.push({
        label: isTimedOut ? 'Remove Timeout' : 'Timeout', icon: 'Clock',
        onClick: () => setTimeoutTarget({ userId, username, isTimedOut, timeoutUntil: member.timeout_until }),
      });
    }
    if (canKick) {
      items.push({
        label: 'Kick', icon: 'UserX', variant: 'warning',
        onClick: () => setKickTarget({ userId, username }),
      });
    }
    if (canBan) {
      items.push({
        label: 'Ban', icon: 'Ban', variant: 'danger',
        onClick: () => { setBanReason(''); setBanTarget({ userId, username }); },
      });
    }

    useContextMenuStore.getState().open(e.clientX, e.clientY, items);
  }, [currentUser?.id, ownerId, canKick, canBan, canManageNicknames, canManageRoles, canTimeout, serverId, getName]);

  const handleMembersChanged = useCallback(() => {
    fetchMembersWithRoles(serverId);
  }, [serverId, fetchMembersWithRoles]);

  const online = serverMembers.filter((m) => {
    const s = statuses[m.user_id];
    return s && s !== 'offline';
  });
  const offline = serverMembers.filter((m) => {
    const s = statuses[m.user_id];
    return !s || s === 'offline';
  });

  const renderMember = (m: typeof serverMembers[0], isOffline?: boolean) => {
    const topRole = getTopRole(m.role_ids);
    const nameColor = topRole ? colorToHex(topRole.color) : undefined;
    const isTimedOut = !!m.timeout_until && new Date(m.timeout_until) > new Date();

    return (
      <MemberItem
        key={m.id}
        userId={m.user_id}
        nickname={m.nickname}
        user={users[m.user_id]}
        status={statuses[m.user_id] ?? 'online'}
        roleColor={nameColor}
        isOwner={ownerId === m.user_id}
        isTimedOut={isTimedOut}
        timeoutUntil={m.timeout_until}
        topRoleName={topRole?.name}
        topRoleColorHex={topRole && topRole.color !== 0 ? colorToHex(topRole.color) : undefined}
        isOffline={isOffline}
        onClick={(e) => openProfile(m.user_id, e)}
        onContextMenu={(e) => handleContextMenu(m.user_id, e)}
      />
    );
  };

  const assignableRoles = serverRoles.filter((r) => !r.is_default);

  const handleKick = async () => {
    if (!kickTarget) return;
    setActionError('');
    setActionLoading(true);
    try {
      await api.kickMember(serverId, kickTarget.userId);
      handleMembersChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionLoading(false);
      setKickTarget(null);
    }
  };

  const handleBan = async () => {
    if (!banTarget) return;
    setActionError('');
    setActionLoading(true);
    try {
      await api.banMember(serverId, banTarget.userId, banReason.trim() || undefined);
      setBanReason('');
      handleMembersChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionLoading(false);
      setBanTarget(null);
    }
  };

  const handleSetNickname = async () => {
    if (!nicknameTarget) return;
    setActionError('');
    setActionLoading(true);
    try {
      await api.setNickname(serverId, nicknameTarget.userId, nicknameValue.trim() || undefined);
      setNicknameValue('');
      handleMembersChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionLoading(false);
      setNicknameTarget(null);
    }
  };

  const handleToggleRole = useCallback(async (roleId: string, hasRole: boolean) => {
    if (!roleTarget) return;
    setRoleSaving(true);
    setActionError('');
    try {
      if (hasRole) {
        await api.removeRole(serverId, roleId, roleTarget.userId);
      } else {
        await api.assignRole(serverId, roleId, roleTarget.userId);
      }
      handleMembersChanged();
      // Update local role list
      setRoleTarget((prev) => {
        if (!prev) return null;
        const updatedIds = hasRole
          ? prev.memberRoleIds.filter((id) => id !== roleId)
          : [...prev.memberRoleIds, roleId];
        return { ...prev, memberRoleIds: updatedIds };
      });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setRoleSaving(false);
    }
  }, [serverId, roleTarget, handleMembersChanged]);

  const handleTimeout = async (seconds: number) => {
    if (!timeoutTarget) return;
    setActionError('');
    setActionLoading(true);
    try {
      const until = new Date(Date.now() + seconds * 1000).toISOString();
      await api.timeoutMember(serverId, timeoutTarget.userId, until);
      handleMembersChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionLoading(false);
      setTimeoutTarget(null);
    }
  };

  const handleRemoveTimeout = async () => {
    if (!timeoutTarget) return;
    setActionError('');
    setActionLoading(true);
    try {
      await api.removeTimeout(serverId, timeoutTarget.userId);
      handleMembersChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionLoading(false);
      setTimeoutTarget(null);
    }
  };

  return (
    <div className={className ?? "w-65 h-full bg-sidebar border-l border-divider overflow-y-auto shrink-0"}>
      {loadError && (
        <div className="mx-4 mt-2 text-text-tertiary text-xs text-center py-4">Failed to load members</div>
      )}
      {actionError && (
        <div className="mx-4 mt-2 bg-danger/10 text-danger text-xs p-2 rounded">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 text-danger/70 hover:text-danger">&times;</button>
        </div>
      )}

      {online.length > 0 && (
        <div className="px-4 pt-4">
          <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
            Online —{online.length}
          </div>
          {online.map((m) => renderMember(m))}
        </div>
      )}

      {offline.length > 0 && (
        <div className="px-4 pt-4">
          <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
            Offline —{offline.length}
          </div>
          {offline.map((m) => renderMember(m, true))}
        </div>
      )}

      {!loadError && online.length === 0 && offline.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 rounded-full border-2 border-divider border-t-text-muted animate-spin" />
        </div>
      )}

      {profileTarget && (
        <UserProfileCard
          userId={profileTarget.userId}
          user={users[profileTarget.userId]}
          anchor={profileTarget.anchor}
          onClose={() => setProfileTarget(null)}
        />
      )}

      {/* Kick confirm */}
      {kickTarget && (
        <ConfirmDialog
          title="Kick Member"
          message={`Are you sure you want to kick ${kickTarget.username} from the server?`}
          confirmLabel="Kick"
          danger
          onConfirm={handleKick}
          onCancel={() => setKickTarget(null)}
        />
      )}

      {/* Ban dialog */}
      {banTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setBanTarget(null)}>
          <div role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-6 w-100 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-1">Ban Member</h3>
            <p className="text-text-tertiary text-sm mb-3">
              Ban <span className="text-text-primary font-medium">{banTarget.username}</span> from the server? They will be removed and unable to rejoin.
            </p>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              Reason (Optional)
            </label>
            <textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Reason for ban..."
              className="w-full mt-1 px-3 py-2 bg-bg border border-divider rounded-lg text-text-primary text-sm resize-none mb-4"
              rows={2}
              maxLength={512}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setBanTarget(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                Cancel
              </button>
              <button
                onClick={handleBan}
                disabled={actionLoading}
                className="px-4 py-2 bg-danger hover:bg-danger/80 text-white text-sm rounded disabled:opacity-50"
              >
                {actionLoading ? 'Banning...' : 'Ban'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role popover */}
      {roleTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setRoleTarget(null)}>
          <div role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-4 w-70 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-text-primary text-sm font-semibold mb-2">
              Manage Roles —{roleTarget.username}
            </h4>
            <div className="space-y-0.5 max-h-62 overflow-y-auto">
              {assignableRoles.length === 0 && (
                <div className="text-text-tertiary text-xs py-2">No roles available</div>
              )}
              {assignableRoles.map((role) => {
                const has = roleTarget.memberRoleIds.includes(role.id);
                return (
                  <button
                    key={role.id}
                    onClick={() => handleToggleRole(role.id, has)}
                    disabled={roleSaving}
                    className="w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-hover rounded disabled:opacity-50"
                  >
                    <input type="checkbox" checked={has} readOnly className="w-3.5 h-3.5 rounded accent-primary pointer-events-none" />
                    {role.color !== 0 && (
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `#${role.color.toString(16).padStart(6, '0')}` }} />
                    )}
                    <span className="text-text-secondary truncate">{role.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-3">
              <button onClick={() => setRoleTarget(null)} className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timeout dialog */}
      {timeoutTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setTimeoutTarget(null)}>
          <div role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-6 w-80 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-3">
              {timeoutTarget.isTimedOut ? 'Remove Timeout' : 'Timeout Member'}
            </h3>
            <p className="text-text-tertiary text-sm mb-4">
              {timeoutTarget.isTimedOut
                ? `${timeoutTarget.username} is timed out until ${new Date(timeoutTarget.timeoutUntil!).toLocaleString()}`
                : `Timeout ${timeoutTarget.username} — they won't be able to send messages or react.`
              }
            </p>
            {timeoutTarget.isTimedOut ? (
              <div className="flex justify-end gap-2">
                <button onClick={() => setTimeoutTarget(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                <button onClick={handleRemoveTimeout} disabled={actionLoading} className="px-4 py-2 btn-primary text-sm rounded-lg disabled:opacity-50">
                  Remove Timeout
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {[
                  { label: '60 seconds', seconds: 60 },
                  { label: '5 minutes', seconds: 300 },
                  { label: '10 minutes', seconds: 600 },
                  { label: '1 hour', seconds: 3600 },
                  { label: '1 day', seconds: 86400 },
                  { label: '1 week', seconds: 604800 },
                ].map(({ label, seconds }) => (
                  <button
                    key={seconds}
                    onClick={() => handleTimeout(seconds)}
                    disabled={actionLoading}
                    className="w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary text-left rounded disabled:opacity-50"
                  >
                    {label}
                  </button>
                ))}
                <div className="flex justify-end mt-2">
                  <button onClick={() => setTimeoutTarget(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Nickname dialog */}
      {nicknameTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setNicknameTarget(null)}>
          <div role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-6 w-100 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-3">Change Nickname</h3>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              Nickname
            </label>
            <input
              value={nicknameValue}
              onChange={(e) => setNicknameValue(e.target.value)}
              placeholder="Leave empty to reset"
              className="w-full mt-1 px-3 py-2 bg-bg border border-divider rounded-lg text-text-primary text-sm mb-4"
              maxLength={32}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && !actionLoading && handleSetNickname()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setNicknameTarget(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                Cancel
              </button>
              <button
                onClick={handleSetNickname}
                disabled={actionLoading}
                className="px-4 py-2 btn-primary text-sm rounded-lg disabled:opacity-50"
              >
                {actionLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
