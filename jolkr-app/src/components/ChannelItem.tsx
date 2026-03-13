import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import type { Channel } from '../api/types';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Mic, BellOff, Settings } from 'lucide-react';

export function SortableChannelItem({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  if (disabled) return <>{children}</>;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

interface ChannelItemProps {
  channel: Channel;
  serverId: string;
  isActive: boolean;
  unreadCount: number;
  isInVoice: boolean;
  isMuted: boolean;
  canManage: boolean;
  onClick?: () => void;
  onContextMenu: (channelId: string, e: React.MouseEvent) => void;
  onEdit: (ch: Channel) => void;
  dragLockRef: React.RefObject<boolean>;
}

const ChannelItem = memo(function ChannelItem({
  channel,
  serverId,
  isActive,
  unreadCount,
  isInVoice,
  isMuted,
  canManage,
  onClick,
  onContextMenu,
  onEdit,
  dragLockRef,
}: ChannelItemProps) {
  const isVoice = channel.kind === 'voice';

  const handleClick = (e: React.MouseEvent) => {
    if (dragLockRef.current) {
      e.stopPropagation();
      e.preventDefault();
      dragLockRef.current = false;
      return;
    }
    onClick?.();
  };

  return (
    <div className="group flex items-center min-w-0">
      <Link
        to={`/servers/${serverId}/channels/${channel.id}`}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(channel.id, e)}
        className={`flex-1 min-w-0 w-full rounded-md px-3 py-2 gap-2 text-left flex items-center text-sm cursor-pointer transition-colors no-underline ${
          isActive
            ? 'bg-bg-active text-text-primary font-semibold'
            : !isMuted && unreadCount > 0
              ? 'text-text-primary font-semibold'
              : 'text-text-secondary font-medium hover:bg-bg-hover hover:text-text-primary'
        }`}
      >
        {isVoice ? (
          <Mic className={`size-4.5 shrink-0 ${isActive ? 'text-text-primary' : 'text-text-muted'}`} />
        ) : (
          <span className={`text-base ${isActive ? 'text-text-primary' : 'text-text-muted'}`}>#</span>
        )}
        <span className="truncate flex-1">{channel.name}</span>
        {isMuted && (
          <BellOff className="size-3.5 text-text-muted shrink-0" />
        )}
        {!isMuted && unreadCount > 0 && !isActive && (
          <span className="min-w-4.5 h-4.5 bg-error rounded-full flex items-center justify-center px-1 shrink-0">
            <span className="text-2xs font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>
          </span>
        )}
        {isInVoice && (
          <span className="w-2 h-2 rounded-full bg-online shrink-0" title="In voice" />
        )}
      </Link>
      {canManage && (
        <button
          onClick={() => onEdit(channel)}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus-within:opacity-100 p-1 text-text-muted hover:text-text-primary shrink-0"
          title="Edit Channel"
          aria-label="Edit Channel"
        >
          <Settings className="size-3.5" />
        </button>
      )}
    </div>
  );
});

export default ChannelItem;
