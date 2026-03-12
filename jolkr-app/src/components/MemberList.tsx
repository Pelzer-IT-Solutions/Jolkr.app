import { useCallback, useEffect, useState, useMemo } from 'react';
import { useServersStore } from '../stores/servers';
import { usePresenceStore } from '../stores/presence';
import { useAuthStore } from '../stores/auth';
import * as api from '../api/client';
import type { User, Role } from '../api/types';
import { hasPermission, KICK_MEMBERS, BAN_MEMBERS, MANAGE_NICKNAMES, MANAGE_ROLES, MODERATE_MEMBERS } from '../utils/permissions';
import UserProfileCard from './UserProfileCard';
import MemberItem from './MemberItem';
import MemberContextMenu from './MemberContextMenu';

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
  const myPerms = useServersStore((s) => s.permissions[serverId] ?? 0);
  const fetchPermissions = useServersStore((s) => s.fetchPermissions);
  const ownerId = useServersStore((s) => s.servers.find((srv) => srv.id === serverId)?.owner_id);
  const statuses = usePresenceStore((s) => s.statuses);
  const setBulk = usePresenceStore((s) => s.setBulk);
  const serverMembers = members[serverId] ?? [];
  const serverRoles = roles[serverId] ?? [];
  const [users, setUsers] = useState<Record<string, User>>({});
  const [profileTarget, setProfileTarget] = useState<{ userId: string; anchor: { x: number; y: number } } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState(false);

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
    setContextMenu(null);
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
    setContextMenu({ userId, x: e.clientX, y: e.clientY });
  }, [currentUser?.id, ownerId, canKick, canBan, canManageNicknames, canManageRoles, canTimeout]);

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

  // Derive context menu target member data
  const contextMember = contextMenu
    ? serverMembers.find((m) => m.user_id === contextMenu.userId)
    : null;

  return (
    <div className={className ?? "w-[260px] h-full glass overflow-y-auto shrink-0"}>
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
          <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
            Online — {online.length}
          </div>
          {online.map((m) => renderMember(m))}
        </div>
      )}

      {offline.length > 0 && (
        <div className="px-4 pt-4">
          <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
            Offline — {offline.length}
          </div>
          {offline.map((m) => renderMember(m, true))}
        </div>
      )}

      {!loadError && online.length === 0 && offline.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
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

      {contextMenu && contextMember && (
        <MemberContextMenu
          userId={contextMenu.userId}
          serverId={serverId}
          username={getName(contextMenu.userId, contextMember.nickname)}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          canKick={canKick}
          canBan={canBan}
          canManageNicknames={canManageNicknames}
          canTimeout={canTimeout}
          canManageRoles={canManageRoles}
          isTargetOwner={ownerId === contextMenu.userId}
          isSelf={currentUser?.id === contextMenu.userId}
          roles={serverRoles}
          memberRoleIds={contextMember.role_ids ?? []}
          memberNickname={contextMember.nickname}
          memberTimeoutUntil={contextMember.timeout_until}
          onClose={() => setContextMenu(null)}
          onMembersChanged={handleMembersChanged}
          onError={setActionError}
        />
      )}
    </div>
  );
}
