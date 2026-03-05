import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useServersStore } from '../stores/servers';
import { usePresenceStore } from '../stores/presence';
import { useAuthStore } from '../stores/auth';
import * as api from '../api/client';
import type { User, Role } from '../api/types';
import { hasPermission, KICK_MEMBERS, BAN_MEMBERS, MANAGE_NICKNAMES, MANAGE_ROLES, MODERATE_MEMBERS } from '../utils/permissions';
import Avatar from './Avatar';
import UserProfileCard from './UserProfileCard';
import ConfirmDialog from './dialogs/ConfirmDialog';

interface Props {
  serverId: string;
  className?: string;
}

/** Convert integer color to hex string */
function colorToHex(color: number | undefined | null): string | undefined {
  if (color == null) return undefined;
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Clamp context menu position to stay within viewport */
function clampMenuPosition(x: number, y: number, menuWidth = 170, menuHeight = 120) {
  const maxX = window.innerWidth - menuWidth - 8;
  const maxY = window.innerHeight - menuHeight - 8;
  return { x: Math.min(x, maxX), y: Math.min(y, maxY) };
}

export default function MemberList({ serverId, className }: Props) {
  const currentUser = useAuthStore((s) => s.user);
  const members = useServersStore((s) => s.members);
  const fetchMembersWithRoles = useServersStore((s) => s.fetchMembersWithRoles);
  const roles = useServersStore((s) => s.roles);
  const fetchRoles = useServersStore((s) => s.fetchRoles);
  const myPerms = useServersStore((s) => s.permissions[serverId] ?? 0);
  const fetchPermissions = useServersStore((s) => s.fetchPermissions);
  const server = useServersStore((s) => s.servers.find((srv) => srv.id === serverId));
  const statuses = usePresenceStore((s) => s.statuses);
  const setBulk = usePresenceStore((s) => s.setBulk);
  const serverMembers = members[serverId] ?? [];
  const serverRoles = roles[serverId] ?? [];
  const [users, setUsers] = useState<Record<string, User>>({});
  const [profileTarget, setProfileTarget] = useState<{ userId: string; anchor: { x: number; y: number } } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [showKickConfirm, setShowKickConfirm] = useState<string | null>(null);
  const [showBanDialog, setShowBanDialog] = useState<string | null>(null);
  const [banReason, setBanReason] = useState('');
  const [showNicknameDialog, setShowNicknameDialog] = useState<string | null>(null);
  const [nicknameValue, setNicknameValue] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const banDialogRef = useRef<HTMLDivElement>(null);
  const nicknameDialogRef = useRef<HTMLDivElement>(null);

  const isOwner = currentUser?.id === server?.owner_id;
  const canKick = isOwner || hasPermission(myPerms, KICK_MEMBERS);
  const canBan = isOwner || hasPermission(myPerms, BAN_MEMBERS);
  const canManageNicknames = isOwner || hasPermission(myPerms, MANAGE_NICKNAMES);
  const canManageRoles = isOwner || hasPermission(myPerms, MANAGE_ROLES);
  const canTimeout = isOwner || hasPermission(myPerms, MODERATE_MEMBERS);

  // Timeout dialog state
  const [showTimeoutDialog, setShowTimeoutDialog] = useState<string | null>(null);

  // Manage roles popover state
  const [rolePopover, setRolePopover] = useState<string | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);

  // Build a role lookup map
  const roleMap = useMemo(() => {
    const map: Record<string, Role> = {};
    for (const r of serverRoles) map[r.id] = r;
    return map;
  }, [serverRoles]);

  // Clear actionError on server switch
  useEffect(() => {
    setActionError('');
    setContextMenu(null);
    setShowKickConfirm(null);
    setShowBanDialog(null);
    setShowNicknameDialog(null);
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

      // Batch fetch all user profiles — fallback to individual fetches if batch endpoint unavailable
      if (ids.length > 0) {
        api.getUsersBatch(ids).then((fetchedUsers) => {
          if (cancelled) return;
          const map: Record<string, User> = {};
          for (const u of fetchedUsers) map[u.id] = u;
          setUsers(map);
        }).catch(() => {
          // Fallback: fetch users individually
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

  const getName = (userId: string, nickname?: string | null) =>
    nickname ?? users[userId]?.username ?? 'Unknown';

  const getAvatar = (userId: string) => users[userId]?.avatar_url;

  /** Get the highest-positioned role for a member (for display color) */
  const getTopRole = (roleIds?: string[]): Role | undefined => {
    if (!roleIds || roleIds.length === 0) return undefined;
    const memberRoles = roleIds
      .map((id) => roleMap[id])
      .filter((r): r is Role => !!r && !r.is_default)
      .sort((a, b) => b.position - a.position);
    return memberRoles[0];
  };

  const openProfile = (userId: string, e: React.MouseEvent) => {
    setProfileTarget({ userId, anchor: { x: e.clientX, y: e.clientY } });
  };

  const assignableRoles = useMemo(() =>
    serverRoles.filter((r) => !r.is_default),
    [serverRoles]
  );

  const handleToggleRole = useCallback(async (userId: string, roleId: string, hasRole: boolean) => {
    setRoleSaving(true);
    setActionError('');
    try {
      if (hasRole) {
        await api.removeRole(serverId, roleId, userId);
      } else {
        await api.assignRole(serverId, roleId, userId);
      }
      fetchMembersWithRoles(serverId);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setRoleSaving(false);
    }
  }, [serverId, fetchMembersWithRoles]);

  const handleContextMenu = useCallback((userId: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (userId === currentUser?.id) return;
    if (userId === server?.owner_id) return;
    if (!canKick && !canBan && !canManageNicknames && !canManageRoles && !canTimeout) return;
    const pos = clampMenuPosition(e.clientX, e.clientY);
    setContextMenu({ userId, x: pos.x, y: pos.y });
  }, [currentUser?.id, server?.owner_id, canKick, canBan, canManageNicknames, canManageRoles]);

  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside + keyboard navigation
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    // Focus the first menu item when opened
    requestAnimationFrame(() => {
      const items = contextMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      items?.[0]?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const items = contextMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
        if (!items || items.length === 0) return;
        const current = document.activeElement as HTMLElement;
        const idx = Array.from(items).indexOf(current);
        let next = 0;
        if (e.key === 'ArrowDown') next = idx < items.length - 1 ? idx + 1 : 0;
        else if (e.key === 'ArrowUp') next = idx > 0 ? idx - 1 : items.length - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        items[next]?.focus();
      }
      if (e.key === 'Tab') { e.preventDefault(); close(); }
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // Escape key handler for ban dialog
  useEffect(() => {
    if (!showBanDialog) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowBanDialog(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showBanDialog]);

  // Escape key handler for nickname dialog
  useEffect(() => {
    if (!showNicknameDialog) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowNicknameDialog(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNicknameDialog]);

  const handleKick = async (userId: string) => {
    setShowKickConfirm(null);
    setActionError('');
    setActionLoading(true);
    try {
      await api.kickMember(serverId, userId);
      fetchMembersWithRoles(serverId);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBan = async (userId: string) => {
    setShowBanDialog(null);
    setActionError('');
    setActionLoading(true);
    try {
      await api.banMember(serverId, userId, banReason.trim() || undefined);
      setBanReason('');
      fetchMembersWithRoles(serverId);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetNickname = async (userId: string) => {
    setShowNicknameDialog(null);
    setActionError('');
    setActionLoading(true);
    try {
      await api.setNickname(serverId, userId, nicknameValue.trim() || undefined);
      setNicknameValue('');
      fetchMembersWithRoles(serverId);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

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

    return (
      <button
        key={m.id}
        onClick={(e) => openProfile(m.user_id, e)}
        onContextMenu={(e) => handleContextMenu(m.user_id, e)}
        className={`w-full flex items-center gap-2 py-1.5 px-1 rounded hover:bg-white/5 cursor-pointer ${isOffline ? 'opacity-50' : ''}`}
      >
        <Avatar
          url={getAvatar(m.user_id)}
          name={getName(m.user_id, m.nickname)}
          size={32}
          status={isOffline ? 'offline' : (statuses[m.user_id] ?? 'online')}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            <div
              className="text-sm truncate min-w-0"
              style={nameColor ? { color: nameColor } : undefined}
            >
              {getName(m.user_id, m.nickname)}
            </div>
            {server?.owner_id === m.user_id && (
              <span className="px-1 py-0.5 text-[9px] bg-primary/20 text-primary rounded font-bold uppercase shrink-0">
                Owner
              </span>
            )}
            {m.timeout_until && new Date(m.timeout_until) > new Date() && (
              <span className="px-1 py-0.5 text-[9px] bg-warning/20 text-warning rounded font-bold uppercase shrink-0" title={`Timed out until ${new Date(m.timeout_until).toLocaleString()}`}>
                Timed out
              </span>
            )}
            {topRole && topRole.color !== 0 && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: colorToHex(topRole.color) }}
                title={topRole.name}
              />
            )}
          </div>
          {users[m.user_id]?.status && (
            <div className="text-[11px] text-text-muted truncate">{users[m.user_id].status}</div>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className={className ?? "w-[240px] h-full bg-sidebar border-l border-divider overflow-y-auto shrink-0"}>
      {loadError && (
        <div className="mx-4 mt-2 text-text-muted text-xs text-center py-4">Failed to load members</div>
      )}
      {actionError && (
        <div className="mx-4 mt-2 bg-error/10 text-error text-xs p-2 rounded">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 text-error/70 hover:text-error">×</button>
        </div>
      )}

      {online.length > 0 && (
        <div className="px-4 pt-4">
          <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">
            Online — {online.length}
          </div>
          {online.map((m) => renderMember(m))}
        </div>
      )}

      {offline.length > 0 && (
        <div className="px-4 pt-4">
          <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">
            Offline — {offline.length}
          </div>
          {offline.map((m) => renderMember(m, true))}
        </div>
      )}

      {!loadError && online.length === 0 && offline.length === 0 && (
        <div className="px-4 py-6 text-center text-text-muted text-sm">No members found</div>
      )}

      {profileTarget && (
        <UserProfileCard
          userId={profileTarget.userId}
          user={users[profileTarget.userId]}
          anchor={profileTarget.anchor}
          onClose={() => setProfileTarget(null)}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          className="fixed z-50 bg-surface border border-divider rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {canManageRoles && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary text-left"
              onClick={(e) => {
                e.stopPropagation();
                setRolePopover(contextMenu.userId);
                setContextMenu(null);
              }}
            >
              Manage Roles
            </button>
          )}
          {canManageNicknames && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary text-left"
              onClick={() => {
                const member = serverMembers.find((m) => m.user_id === contextMenu.userId);
                setNicknameValue(member?.nickname ?? '');
                setShowNicknameDialog(contextMenu.userId);
                setContextMenu(null);
              }}
            >
              Change Nickname
            </button>
          )}
          {canTimeout && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary text-left"
              onClick={() => {
                setShowTimeoutDialog(contextMenu.userId);
                setContextMenu(null);
              }}
            >
              {serverMembers.find((m) => m.user_id === contextMenu.userId)?.timeout_until &&
               new Date(serverMembers.find((m) => m.user_id === contextMenu.userId)!.timeout_until!) > new Date()
                ? 'Remove Timeout' : 'Timeout'}
            </button>
          )}
          {canKick && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-warning hover:bg-warning/10 text-left"
              onClick={() => {
                setShowKickConfirm(contextMenu.userId);
                setContextMenu(null);
              }}
            >
              Kick
            </button>
          )}
          {canBan && (
            <button
              role="menuitem"
              className="w-full px-3 py-1.5 text-sm text-error hover:bg-error/10 text-left"
              onClick={() => {
                setBanReason('');
                setShowBanDialog(contextMenu.userId);
                setContextMenu(null);
              }}
            >
              Ban
            </button>
          )}
        </div>
      )}

      {/* Kick confirm */}
      {showKickConfirm && (
        <ConfirmDialog
          title="Kick Member"
          message={`Are you sure you want to kick ${getName(showKickConfirm)} from the server?`}
          confirmLabel="Kick"
          danger
          onConfirm={() => handleKick(showKickConfirm)}
          onCancel={() => setShowKickConfirm(null)}
        />
      )}

      {/* Ban dialog */}
      {showBanDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowBanDialog(null)}>
          <div ref={banDialogRef} role="dialog" aria-modal="true" className="bg-surface rounded-lg p-6 w-[400px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-1">Ban Member</h3>
            <p className="text-text-muted text-sm mb-3">
              Ban <span className="text-text-primary font-medium">{getName(showBanDialog)}</span> from the server? They will be removed and unable to rejoin.
            </p>
            <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
              Reason (Optional)
            </label>
            <textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Reason for ban..."
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm resize-none mb-4"
              rows={2}
              maxLength={512}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowBanDialog(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                Cancel
              </button>
              <button
                onClick={() => handleBan(showBanDialog)}
                disabled={actionLoading}
                className="px-4 py-2 bg-error hover:bg-error/80 text-white text-sm rounded disabled:opacity-50"
              >
                {actionLoading ? 'Banning...' : 'Ban'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role popover */}
      {rolePopover && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setRolePopover(null)}>
          <div role="dialog" aria-modal="true" className="bg-surface rounded-lg p-4 w-[280px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-text-primary text-sm font-semibold mb-2">
              Manage Roles — {getName(rolePopover)}
            </h4>
            <div className="space-y-0.5 max-h-[250px] overflow-y-auto">
              {assignableRoles.length === 0 && (
                <div className="text-text-muted text-xs py-2">No roles available</div>
              )}
              {assignableRoles.map((role) => {
                const member = serverMembers.find((m) => m.user_id === rolePopover);
                const has = (member?.role_ids ?? []).includes(role.id);
                return (
                  <button
                    key={role.id}
                    onClick={() => handleToggleRole(rolePopover, role.id, has)}
                    disabled={roleSaving}
                    className="w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-white/5 rounded disabled:opacity-50"
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
              <button onClick={() => setRolePopover(null)} className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timeout dialog */}
      {showTimeoutDialog && (() => {
        const member = serverMembers.find((m) => m.user_id === showTimeoutDialog);
        const isTimedOut = member?.timeout_until && new Date(member.timeout_until) > new Date();
        const handleTimeout = async (seconds: number) => {
          setShowTimeoutDialog(null);
          setActionError('');
          setActionLoading(true);
          try {
            const until = new Date(Date.now() + seconds * 1000).toISOString();
            await api.timeoutMember(serverId, showTimeoutDialog, until);
            fetchMembersWithRoles(serverId);
          } catch (e) {
            setActionError((e as Error).message);
          } finally {
            setActionLoading(false);
          }
        };
        const handleRemoveTimeout = async () => {
          setShowTimeoutDialog(null);
          setActionError('');
          setActionLoading(true);
          try {
            await api.removeTimeout(serverId, showTimeoutDialog);
            fetchMembersWithRoles(serverId);
          } catch (e) {
            setActionError((e as Error).message);
          } finally {
            setActionLoading(false);
          }
        };
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowTimeoutDialog(null)}>
            <div role="dialog" aria-modal="true" className="bg-surface rounded-lg p-6 w-[320px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-text-primary text-lg font-semibold mb-3">
                {isTimedOut ? 'Remove Timeout' : 'Timeout Member'}
              </h3>
              <p className="text-text-muted text-sm mb-4">
                {isTimedOut
                  ? `${getName(showTimeoutDialog)} is timed out until ${new Date(member!.timeout_until!).toLocaleString()}`
                  : `Timeout ${getName(showTimeoutDialog)} — they won't be able to send messages or react.`
                }
              </p>
              {isTimedOut ? (
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowTimeoutDialog(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                  <button onClick={handleRemoveTimeout} disabled={actionLoading} className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50">
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
                      className="w-full px-3 py-2 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary text-left rounded disabled:opacity-50"
                    >
                      {label}
                    </button>
                  ))}
                  <div className="flex justify-end mt-2">
                    <button onClick={() => setShowTimeoutDialog(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Nickname dialog */}
      {showNicknameDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowNicknameDialog(null)}>
          <div ref={nicknameDialogRef} role="dialog" aria-modal="true" className="bg-surface rounded-lg p-6 w-[400px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-3">Change Nickname</h3>
            <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
              Nickname
            </label>
            <input
              value={nicknameValue}
              onChange={(e) => setNicknameValue(e.target.value)}
              placeholder="Leave empty to reset"
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm mb-4"
              maxLength={32}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && !actionLoading && handleSetNickname(showNicknameDialog)}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNicknameDialog(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                Cancel
              </button>
              <button
                onClick={() => handleSetNickname(showNicknameDialog)}
                disabled={actionLoading}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50"
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
