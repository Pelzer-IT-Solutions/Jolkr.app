import React, { memo, useEffect, useState } from 'react';
import type { Channel, Category, User } from '../api/types';
import ChannelItem, { SortableChannelItem } from './ChannelItem';
import Avatar from './Avatar';
import { DndContext, closestCenter, useSensors } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import * as api from '../api/client';
import { MicOff, ChevronDown, Plus } from 'lucide-react';

// ── Text Channel Group (with DnD support) ────────────────────────────────

interface TextChannelGroupProps {
  channels: Channel[];
  activeChannelId?: string;
  serverId: string;
  unreadCounts: Record<string, number>;
  canManage: boolean;
  onChannelSelect?: () => void;
  onEditChannel: (ch: Channel) => void;
  mutedChannels: Map<string, boolean>;
  onChannelContextMenu: (channelId: string, e: React.MouseEvent) => void;
  canDrag: boolean;
  onDragEnd: (event: DragEndEvent) => void;
  sensors: ReturnType<typeof useSensors>;
  dragLockRef: React.RefObject<boolean>;
}

function TextChannelGroup({
  channels,
  activeChannelId,
  serverId,
  unreadCounts,
  canManage,
  onChannelSelect,
  onEditChannel,
  mutedChannels,
  onChannelContextMenu,
  canDrag,
  onDragEnd,
  sensors,
  dragLockRef,
}: TextChannelGroupProps) {
  if (channels.length === 0) return null;

  const items = channels.map((ch) => (
    <SortableChannelItem key={ch.id} id={ch.id} disabled={!canDrag}>
      <ChannelItem
        channel={ch}
        serverId={serverId}
        isActive={activeChannelId === ch.id}
        unreadCount={unreadCounts[ch.id] ?? 0}
        isInVoice={false}
        isMuted={mutedChannels.get(ch.id) ?? false}
        canManage={canManage}
        onClick={onChannelSelect}
        onContextMenu={onChannelContextMenu}
        onEdit={onEditChannel}
        dragLockRef={dragLockRef}
      />
    </SortableChannelItem>
  ));

  if (canDrag) {
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={(e) => { dragLockRef.current = true; onDragEnd(e); }}
      >
        <SortableContext items={channels.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {items}
        </SortableContext>
      </DndContext>
    );
  }

  return <>{items}</>;
}

// ── Voice Channel Group ───────────────────────────────────────────────────

interface VoiceChannelGroupProps {
  channels: Channel[];
  serverId: string;
  voiceChannelId: string | null;
  voiceParticipants: Array<{ userId: string; isMuted: boolean; isSpeaking: boolean }>;
  canManage: boolean;
  onEditChannel: (ch: Channel) => void;
  userCacheRef: React.RefObject<Record<string, User>>;
  onChannelSelect?: () => void;
  dragLockRef: React.RefObject<boolean>;
}

function VoiceChannelGroup({
  channels,
  serverId,
  voiceChannelId,
  voiceParticipants,
  canManage,
  onEditChannel,
  userCacheRef,
  onChannelSelect,
  dragLockRef,
}: VoiceChannelGroupProps) {
  if (channels.length === 0) return null;

  return (
    <>
      {channels.map((ch) => {
        const isActive = voiceChannelId === ch.id;
        const channelParticipants = isActive ? voiceParticipants : [];
        return (
          <div key={ch.id}>
            <ChannelItem
              channel={ch}
              serverId={serverId}
              isActive={isActive}
              unreadCount={0}
              isInVoice={isActive}
              isMuted={false}
              canManage={canManage}
              onClick={onChannelSelect}
              onContextMenu={() => {}}
              onEdit={onEditChannel}
              dragLockRef={dragLockRef}
            />
            {channelParticipants.length > 0 && (
              <div className="ml-4 py-0.5">
                {channelParticipants.map((p) => (
                  <VoiceParticipantItem key={p.userId} participant={p} userCache={userCacheRef} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Voice Participant ─────────────────────────────────────────────────────

function VoiceParticipantItem({
  participant,
  userCache,
}: {
  participant: { userId: string; isMuted: boolean; isSpeaking: boolean };
  userCache: React.RefObject<Record<string, User>>;
}) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const cached = userCache.current[participant.userId];
    if (cached) {
      setUser(cached);
      return;
    }
    api.getUser(participant.userId).then((u) => {
      userCache.current[participant.userId] = u;
      setUser(u);
    }).catch(() => {});
  }, [participant.userId]);

  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5">
      <div className={`shrink-0 rounded-full ${participant.isSpeaking ? 'ring-2 ring-online' : ''}`}>
        <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={20} userId={user?.id} />
      </div>
      <span className="text-xs text-text-secondary truncate">{user?.username ?? '...'}</span>
      {participant.isMuted && (
        <MicOff className="size-3 text-danger shrink-0" />
      )}
    </div>
  );
}

// ── Category Group (collapsible header + text + voice channels) ───────────

interface CategoryGroupProps {
  category: Category;
  textChannels: Channel[];
  voiceChannels: Channel[];
  serverId: string;
  activeChannelId?: string;
  unreadCounts: Record<string, number>;
  voiceChannelId: string | null;
  voiceParticipants: Array<{ userId: string; isMuted: boolean; isSpeaking: boolean }>;
  mutedChannels: Map<string, boolean>;
  canManage: boolean;
  onChannelSelect?: () => void;
  onEditChannel: (ch: Channel) => void;
  onChannelContextMenu: (channelId: string, e: React.MouseEvent) => void;
  onCategoryContextMenu: (categoryId: string, e: React.MouseEvent) => void;
  onCreateInCategory: (categoryId: string) => void;
  collapsed: boolean;
  onToggleCollapse: (categoryId: string) => void;
  onTextDragEnd: (event: DragEndEvent) => void;
  sensors: ReturnType<typeof useSensors>;
  userCacheRef: React.RefObject<Record<string, User>>;
  dragLockRef: React.RefObject<boolean>;
}

const CategoryGroup = memo(function CategoryGroup({
  category,
  textChannels,
  voiceChannels,
  serverId,
  activeChannelId,
  unreadCounts,
  voiceChannelId,
  voiceParticipants,
  mutedChannels,
  canManage,
  onChannelSelect,
  onEditChannel,
  onChannelContextMenu,
  onCategoryContextMenu,
  onCreateInCategory,
  collapsed,
  onToggleCollapse,
  onTextDragEnd,
  sensors,
  userCacheRef,
  dragLockRef,
}: CategoryGroupProps) {
  return (
    <div className="mb-1">
      <button
        onClick={() => onToggleCollapse(category.id)}
        onContextMenu={(e) => onCategoryContextMenu(category.id, e)}
        aria-expanded={!collapsed}
        aria-label={`${category.name} category`}
        className="w-full pl-2 pt-3 pb-1 text-xs font-semibold text-text-tertiary uppercase tracking-wider flex items-center gap-2 hover:text-text-secondary group"
      >
        <ChevronDown className={`size-3 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        <span className="truncate flex-1 text-left">{category.name}</span>
        {canManage && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onCreateInCategory(category.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onCreateInCategory(category.id); } }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 focus-within:opacity-100 text-text-tertiary hover:text-text-primary"
            title="Create Channel"
            aria-label={`Create channel in ${category.name}`}
          >
            <Plus className="size-3.5" />
          </span>
        )}
      </button>

      {!collapsed && (
        <>
          <TextChannelGroup
            channels={textChannels}
            activeChannelId={activeChannelId}
            serverId={serverId}
            unreadCounts={unreadCounts}
            canManage={canManage}
            onChannelSelect={onChannelSelect}
            onEditChannel={onEditChannel}
            mutedChannels={mutedChannels}
            onChannelContextMenu={onChannelContextMenu}
            canDrag={canManage}
            onDragEnd={onTextDragEnd}
            sensors={sensors}
            dragLockRef={dragLockRef}
          />
          <VoiceChannelGroup
            channels={voiceChannels}
            serverId={serverId}
            voiceChannelId={voiceChannelId}
            voiceParticipants={voiceParticipants}
            canManage={canManage}
            onEditChannel={onEditChannel}
            userCacheRef={userCacheRef}
            onChannelSelect={onChannelSelect}
            dragLockRef={dragLockRef}
          />
        </>
      )}
    </div>
  );
});

export { TextChannelGroup, VoiceChannelGroup };
export default CategoryGroup;
