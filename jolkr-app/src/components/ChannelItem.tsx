import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import type { Channel } from '../api/types';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
        className={`flex-1 min-w-0 px-2.5 py-1.5 rounded text-left flex items-center gap-1.5 text-sm cursor-pointer transition-colors no-underline ${
          isActive
            ? 'bg-primary/15 text-text-primary'
            : !isMuted && unreadCount > 0
              ? 'text-text-primary font-semibold'
              : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
        }`}
      >
        {isVoice ? (
          <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        ) : (
          <span className="text-text-muted">#</span>
        )}
        <span className="truncate flex-1">{channel.name}</span>
        {isMuted && (
          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          </svg>
        )}
        {!isMuted && unreadCount > 0 && !isActive && (
          <span className="min-w-[18px] h-[18px] bg-error rounded-full flex items-center justify-center px-1 shrink-0">
            <span className="text-[10px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>
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
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}
    </div>
  );
});

export default ChannelItem;
