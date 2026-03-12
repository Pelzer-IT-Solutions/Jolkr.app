import React from 'react';
import type { User } from '../api/types';
import Avatar from './Avatar';

export interface MemberItemProps {
  userId: string;
  nickname?: string | null;
  user: User | undefined;
  status: string;
  roleColor: string | undefined;
  isOwner: boolean;
  isTimedOut: boolean;
  timeoutUntil?: string | null;
  topRoleName?: string;
  topRoleColorHex?: string;
  isOffline?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function MemberItemInner({
  nickname,
  user,
  status,
  roleColor,
  isOwner,
  isTimedOut,
  timeoutUntil,
  topRoleName,
  topRoleColorHex,
  isOffline,
  onClick,
  onContextMenu,
}: MemberItemProps) {
  const name = nickname ?? user?.username ?? 'Unknown';

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full flex items-center gap-2 py-2 px-2 rounded hover:bg-white/[0.06] cursor-pointer ${isOffline ? 'opacity-50' : ''}`}
    >
      <Avatar
        url={user?.avatar_url}
        name={name}
        size={36}
        status={isOffline ? 'offline' : status}
        userId={user?.id}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
          <div
            className="text-sm truncate min-w-0"
            style={roleColor ? { color: roleColor } : undefined}
          >
            {name}
          </div>
          {isOwner && (
            <span className="px-1 py-0.5 text-[10px] bg-primary/20 text-primary rounded font-bold uppercase shrink-0">
              Owner
            </span>
          )}
          {isTimedOut && (
            <span
              className="px-1 py-0.5 text-[10px] bg-warning/20 text-warning rounded font-bold uppercase shrink-0"
              title={timeoutUntil ? `Timed out until ${new Date(timeoutUntil).toLocaleString()}` : undefined}
            >
              Timed out
            </span>
          )}
          {topRoleColorHex && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: topRoleColorHex }}
              title={topRoleName}
            />
          )}
        </div>
        {user?.status && (
          <div className="text-[11px] text-text-muted truncate">{user.status}</div>
        )}
      </div>
    </button>
  );
}

const MemberItem = React.memo(MemberItemInner);
export default MemberItem;
