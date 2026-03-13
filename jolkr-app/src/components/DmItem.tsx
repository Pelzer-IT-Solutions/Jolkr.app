import React from 'react';
import { Link } from 'react-router-dom';
import type { DmChannel, User } from '../api/types';
import Avatar from './Avatar';
import { Badge } from './ui';
import { Users } from 'lucide-react';

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
      className={`
        w-full rounded-lg px-4 py-3 md:px-3 md:py-2 gap-3 flex items-center text-left cursor-pointer transition-colors no-underline
        ${isActive
          ? 'bg-active text-text-primary'
          : unreadCount > 0
            ? 'text-text-primary font-semibold'
            : 'text-text-secondary hover:bg-hover hover:text-text-primary'
        }
      `}
    >
      {isGroup ? (
        <div className="size-9 rounded-full bg-accent/30 flex items-center justify-center shrink-0">
          <Users className="size-4 text-accent" />
        </div>
      ) : (
        <Avatar
          url={otherUser?.avatar_url}
          name={displayName}
          size="md"
          status={status}
          userId={otherUser?.id}
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-text-primary truncate block">{displayName}</span>
        {subtitle ? (
          <span className="text-xs text-text-tertiary truncate block">{subtitle}</span>
        ) : status ? (
          <span className="text-xs text-text-tertiary truncate block capitalize">{status}</span>
        ) : null}
      </div>
      {unreadCount > 0 && !isActive && (
        <Badge count={unreadCount} />
      )}
    </Link>
  );
}

const DmItem = React.memo(DmItemInner);
export default DmItem;

export { getDmDisplay };
