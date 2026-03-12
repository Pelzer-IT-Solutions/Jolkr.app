import React from 'react';
import { Link } from 'react-router-dom';
import type { DmChannel, User } from '../api/types';
import Avatar from './Avatar';

export interface DmItemProps {
  dm: DmChannel;
  users: Record<string, User>;
  currentUserId: string;
  isActive: boolean;
  unreadCount: number;
  status: string | undefined;
  onClick?: () => void;
  onContextMenu: (dm: DmChannel, e: React.MouseEvent) => void;
}

/** Get display info for a DM channel */
function getDmDisplay(dm: DmChannel, users: Record<string, User>, currentUserId: string) {
  const otherIds = dm.members.filter((id) => id !== currentUserId);

  if (dm.is_group) {
    const memberNames = otherIds
      .map((id) => users[id]?.username)
      .filter(Boolean)
      .join(', ');
    const displayName = dm.name || memberNames || 'Group DM';
    const subtitle = `${dm.members.length} members`;
    return { displayName, subtitle, isGroup: true, otherIds, otherId: null, otherUser: null };
  }

  const otherId = otherIds.length > 0 ? otherIds[0] : null;
  const otherUser = otherId ? users[otherId] : null;
  const displayName = dm.name ?? otherUser?.username ?? 'Direct Message';
  return { displayName, subtitle: null, isGroup: false, otherIds, otherId, otherUser };
}

function DmItemInner({ dm, users, currentUserId, isActive, unreadCount, status, onClick, onContextMenu }: DmItemProps) {
  const { displayName, subtitle, isGroup, otherUser } = getDmDisplay(dm, users, currentUserId);

  return (
    <Link
      to={`/dm/${dm.id}`}
      onClick={onClick}
      onContextMenu={(e) => onContextMenu(dm, e)}
      className={`w-full px-2 py-2 rounded flex items-center gap-2 text-sm text-left cursor-pointer transition-colors no-underline ${
        isActive
          ? 'bg-primary/15 text-text-primary'
          : unreadCount > 0
            ? 'text-text-primary font-semibold'
            : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
      }`}
    >
      {isGroup ? (
        <div className="w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
      ) : (
        <Avatar
          url={otherUser?.avatar_url}
          name={displayName}
          size={32}
          status={status}
          userId={otherUser?.id}
        />
      )}
      <div className="flex-1 min-w-0">
        <span className="truncate block">{displayName}</span>
        {subtitle && (
          <span className="text-xs text-text-muted truncate block">{subtitle}</span>
        )}
      </div>
      {unreadCount > 0 && !isActive && (
        <span className="min-w-[18px] h-[18px] bg-error rounded-full flex items-center justify-center px-1 shrink-0">
          <span className="text-[10px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>
        </span>
      )}
    </Link>
  );
}

const DmItem = React.memo(DmItemInner);
export default DmItem;

// Re-export the display helper for use in shell/context menu
export { getDmDisplay };
