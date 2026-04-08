import { useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Reaction } from '../../types';
import { useAuthStore } from '../../stores/auth';
import { useServersStore } from '../../stores/servers';
import { hashColor } from '../../adapters/transforms';
import s from './ReactionTooltip.module.css';

interface Props {
  reaction: Reaction;
  children: React.ReactNode;
  serverId?: string;
  dmParticipantNames?: Record<string, string>; // userId -> display name for DMs
}

interface UserInfo {
  id: string;
  name: string;
  color: string;
  isMe: boolean;
}

function getInitials(name: string): string {
  return (name?.[0] ?? '?').toUpperCase();
}

export function ReactionTooltip({ reaction, children, serverId, dmParticipantNames }: Props) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const serverMembers = useServersStore((state) =>
    serverId ? state.members[serverId] : undefined
  );

  // Resolve userIds from reaction to display names
  const users: UserInfo[] = useMemo(() => {
    const userIds = reaction.userIds ?? [];
    if (!userIds.length) return [];

    return userIds.map((userId) => {
      const isMe = userId === currentUserId;

      // For server channels: look up in server members
      if (serverId && serverMembers) {
        const member = serverMembers.find((m) => m.user_id === userId);
        if (member?.user) {
          return {
            id: userId,
            name: member.nickname || member.user.display_name || member.user.username,
            color: hashColor(userId),
            isMe,
          };
        }
      }

      // For DMs: look up in provided participant names
      if (dmParticipantNames?.[userId]) {
        return {
          id: userId,
          name: dmParticipantNames[userId],
          color: hashColor(userId),
          isMe,
        };
      }

      // Fallback: use "Unknown" with generated color
      return {
        id: userId,
        name: isMe ? 'You' : 'Unknown User',
        color: hashColor(userId),
        isMe,
      };
    });
  }, [reaction.userIds, currentUserId, serverId, serverMembers, dmParticipantNames]);

  // Sort: current user first, then by name
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      if (a.isMe && !b.isMe) return -1;
      if (!a.isMe && b.isMe) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [users]);

  const handleMouseEnter = () => {
    if (!triggerRef.current || sortedUsers.length === 0) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const tooltipHeight = Math.min(sortedUsers.length * 24 + 40, 200); // Estimate with header
    const top = rect.top - tooltipHeight - 8;
    const left = rect.left + rect.width / 2;
    setPosition({ top, left });
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
  };

  // Don't wrap if no users (avoids unnecessary event listeners)
  if (sortedUsers.length === 0) {
    return <>{children}</>;
  }

  // Build tooltip content
  const tooltipContent = (
    <div
      className={s.tooltip}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translateX(-50%)',
      }}
    >
      <div className={s.header}>
        <span className={s.emoji}>{reaction.emoji}</span>
        <span className={s.count}>{reaction.count} reaction{reaction.count !== 1 ? 's' : ''}</span>
      </div>
      <div className={s.userList}>
        {sortedUsers.map((user) => (
          <div key={user.id} className={s.userItem}>
            <div className={s.avatar} style={{ background: user.color }}>
              {getInitials(user.name)}
            </div>
            <span className={`${s.userName} ${user.isMe ? s.isMe : ''}`}>
              {user.isMe ? 'You' : user.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      ref={triggerRef}
      className={s.trigger}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isVisible && createPortal(tooltipContent, document.body)}
    </div>
  );
}
