import { useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { hashColor } from '../../adapters/transforms';
import { useT } from '../../hooks/useT';
import { useAuthStore } from '../../stores/auth';
import { useServersStore } from '../../stores/servers';
import { emojiToImgUrl } from '../../utils/emoji';
import { displayName } from '../../utils/format';
import { Avatar } from '../Avatar/Avatar';
import s from './ReactionTooltip.module.css';
import type { User } from '../../api/types';
import type { ReactionDisplay } from '../../types';

interface Props {
  reaction: ReactionDisplay;
  children: React.ReactNode;
  serverId?: string;
  userMap?: Map<string, User>;
  dmParticipantNames?: Record<string, string>; // userId -> display name for DMs
}

interface UserInfo {
  id: string;
  name: string;
  color: string;
  avatarUrl: string | null;
  isMe: boolean;
}

export function ReactionTooltip({ reaction, children, serverId, userMap, dmParticipantNames }: Props) {
  const { t, tn } = useT();
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const currentUser = useAuthStore((state) => state.user);
  const currentUserId = currentUser?.id;
  const serverMembers = useServersStore((state) =>
    serverId ? state.members[serverId] : undefined
  );

  // Resolve userIds to display names + avatars
  const users: UserInfo[] = useMemo(() => {
    const userIds = reaction.userIds ?? [];
    if (!userIds.length) return [];

    return userIds.map((userId) => {
      const isMe = userId === currentUserId;

      // Current user — use own profile
      if (isMe && currentUser) {
        return {
          id: userId,
          name: displayName(currentUser),
          color: currentUser.banner_color ?? hashColor(userId),
          avatarUrl: currentUser.avatar_url ?? null,
          isMe: true,
        };
      }

      // For server channels: look up in server members
      if (serverId && serverMembers) {
        const member = serverMembers.find((m) => m.user_id === userId);
        if (member?.user) {
          return {
            id: userId,
            name: member.nickname || displayName(member.user),
            color: member.user.banner_color ?? hashColor(userId),
            avatarUrl: member.user.avatar_url ?? null,
            isMe,
          };
        }
      }

      // Fallback: look up in userMap (covers all loaded users incl. DM partners)
      const mapUser = userMap?.get(userId);
      if (mapUser) {
        return {
          id: userId,
          name: displayName(mapUser),
          color: mapUser.banner_color ?? hashColor(userId),
          avatarUrl: mapUser.avatar_url ?? null,
          isMe,
        };
      }

      // For DMs: look up in provided participant names (name-only fallback)
      if (dmParticipantNames?.[userId]) {
        return {
          id: userId,
          name: dmParticipantNames[userId],
          color: hashColor(userId),
          avatarUrl: null,
          isMe,
        };
      }

      // Last resort
      return {
        id: userId,
        name: t('reactions.userFallback', { idShort: userId.slice(0, 6) }),
        color: hashColor(userId),
        avatarUrl: null,
        isMe: false,
      };
    });
  }, [reaction.userIds, currentUserId, currentUser, serverId, serverMembers, userMap, dmParticipantNames, t]);

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
    const tooltipHeight = Math.min(sortedUsers.length * 28 + 44, 200);
    let top = rect.top - tooltipHeight - 8;
    const left = rect.left + rect.width / 2;
    if (top < 8) {
      top = rect.bottom + 8;
    }
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
        <img src={emojiToImgUrl(reaction.emoji)} alt={reaction.emoji} className={s.emojiImg} draggable={false} />
        <span className={s.count}>{tn('reactions.count', reaction.count)}</span>
      </div>
      <div className={`${s.userList}${sortedUsers.length > 6 ? ` ${s.userListScrollable}` : ''}`}>
        {sortedUsers.map((user) => (
          <div key={user.id} className={s.userItem}>
            <Avatar
              url={user.avatarUrl}
              name={user.name}
              size="xs"
              userId={user.id}
              color={user.color}
            />
            <span className={`${s.userName} ${user.isMe ? s.isMe : ''}`}>
              {user.name}
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
