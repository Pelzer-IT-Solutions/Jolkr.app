import React from 'react';
import type { User } from '../api/types';
import Avatar from './Avatar';
import { MessageCircle, Check, X } from 'lucide-react';
import Button from './ui/Button';

interface FriendItemProps {
  user: User;
  status?: string;
  variant?: 'friend' | 'incoming' | 'outgoing' | 'search';
  onMessage?: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  onAdd?: () => void;
}

function FriendItemInner({
  user,
  status,
  variant = 'friend',
  onMessage,
  onAccept,
  onDecline,
  onAdd,
}: FriendItemProps) {
  const statusText = status
    ? status.charAt(0).toUpperCase() + status.slice(1)
    : 'Offline';

  return (
    <div className="flex items-center gap-3 rounded-lg py-3 px-4 hover:bg-hover transition-colors">
      <Avatar
        url={user.avatar_url}
        name={user.display_name || user.username}
        size="lg"
        status={status}
        userId={user.id}
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-text-primary truncate">
          {user.display_name || user.username}
        </span>
        <span className="text-xs text-text-tertiary truncate">{statusText}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {variant === 'friend' && onMessage && (
          <button
            onClick={onMessage}
            className="flex items-center justify-center rounded-full bg-surface p-2 text-text-secondary hover:text-text-primary transition-colors"
            title="Message"
          >
            <MessageCircle className="size-5" />
          </button>
        )}
        {variant === 'incoming' && (
          <>
            {onAccept && (
              <button
                onClick={onAccept}
                className="flex items-center justify-center rounded-full bg-surface p-2 text-success hover:bg-hover transition-colors"
                title="Accept"
              >
                <Check className="size-5" />
              </button>
            )}
            {onDecline && (
              <button
                onClick={onDecline}
                className="flex items-center justify-center rounded-full bg-surface p-2 text-danger hover:bg-hover transition-colors"
                title="Decline"
              >
                <X className="size-5" />
              </button>
            )}
          </>
        )}
        {variant === 'outgoing' && onDecline && (
          <button
            onClick={onDecline}
            className="flex items-center justify-center rounded-full bg-surface p-2 text-danger hover:bg-hover transition-colors"
            title="Cancel"
          >
            <X className="size-5" />
          </button>
        )}
        {variant === 'search' && onAdd && (
          <Button onClick={onAdd} size="sm">
            Add Friend
          </Button>
        )}
      </div>
    </div>
  );
}

const FriendItem = React.memo(FriendItemInner);
export default FriendItem;
