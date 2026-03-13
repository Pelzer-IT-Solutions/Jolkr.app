import type { DmChannel, User } from '../api/types';

export interface DmContextMenuProps {
  dm: DmChannel;
  users: Record<string, User>;
  currentUserId: string;
  position: { x: number; y: number };
  menuRef: React.RefObject<HTMLDivElement | null>;
  friendship: { id: string; status: string } | null;
  onClose: () => void;
  onViewProfile: (dm: DmChannel) => void;
  onAddFriend: (userId: string) => void;
  onRemoveFriend: (userId: string) => void;
  onBlock: (dm: DmChannel) => void;
  onCloseDm: (dm: DmChannel) => void;
  onLeaveGroup: (dm: DmChannel) => void;
}

export default function DmContextMenu({
  dm,
  currentUserId,
  position,
  menuRef,
  friendship,
  onViewProfile,
  onAddFriend,
  onRemoveFriend,
  onBlock,
  onCloseDm,
  onLeaveGroup,
}: DmContextMenuProps) {
  const otherIds = dm.members.filter((id) => id !== currentUserId);
  const isGroup = dm.is_group;
  const otherId = !isGroup && otherIds.length > 0 ? otherIds[0] : null;

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 bg-surface border border-divider rounded-lg shadow-float py-1 min-w-42"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {isGroup ? (
        <button
          role="menuitem"
          className="w-full px-4 py-2 text-sm text-danger hover:bg-danger/10 text-left outline-none focus:bg-hover"
          onClick={() => onLeaveGroup(dm)}
        >
          Leave Group
        </button>
      ) : (
        <>
          <button
            role="menuitem"
            className="w-full px-4 py-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary text-left outline-none focus:bg-hover"
            onClick={() => onViewProfile(dm)}
          >
            View Profile
          </button>

          {friendship?.status === 'accepted' ? (
            <button
              role="menuitem"
              className="w-full px-4 py-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary text-left outline-none focus:bg-hover"
              onClick={() => otherId && onRemoveFriend(otherId)}
            >
              Remove Friend
            </button>
          ) : !friendship ? (
            <button
              role="menuitem"
              className="w-full px-4 py-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary text-left outline-none focus:bg-hover"
              onClick={() => otherId && onAddFriend(otherId)}
            >
              Add Friend
            </button>
          ) : null}

          <div className="my-1 border-t border-divider" />

          <button
            role="menuitem"
            className="w-full px-4 py-2 text-sm text-danger hover:bg-danger/10 text-left outline-none focus:bg-hover"
            onClick={() => onBlock(dm)}
          >
            Block User
          </button>
          <button
            role="menuitem"
            className="w-full px-4 py-2 text-sm text-danger hover:bg-danger/10 text-left outline-none focus:bg-hover"
            onClick={() => onCloseDm(dm)}
          >
            Close DM
          </button>
        </>
      )}
    </div>
  );
}
