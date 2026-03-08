import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useServersStore } from '../stores/servers';
import { useAuthStore } from '../stores/auth';
import { useUnreadStore } from '../stores/unread';
import { useVoiceStore } from '../stores/voice';
import type { Channel, Server, User, Category } from '../api/types';
import { hasPermission, MANAGE_CHANNELS, MANAGE_ROLES } from '../utils/permissions';
import * as api from '../api/client';
import ServerSettingsDialog from './dialogs/ServerSettingsDialog';
import EditChannelDialog from './dialogs/EditChannelDialog';
import InviteDialog from './dialogs/InviteDialog';
import ConfirmDialog from './dialogs/ConfirmDialog';
import Avatar from './Avatar';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DragEndEvent } from '@dnd-kit/core';

// Global drag lock — blocks click events at document level after any drag
let channelDragLock = false;
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (channelDragLock) {
      e.stopPropagation();
      e.preventDefault();
      channelDragLock = false;
    }
  }, true);
}

function SortableChannelItem({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
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

interface Props {
  server: Server;
  onChannelSelect?: () => void;
}

export default function ChannelList({ server, onChannelSelect }: Props) {
  const navigate = useNavigate();
  const { channelId } = useParams();
  const channels = useServersStore((s) => s.channels);
  const fetchChannels = useServersStore((s) => s.fetchChannels);
  const categories = useServersStore((s) => s.categories);
  const fetchCategories = useServersStore((s) => s.fetchCategories);
  const myPerms = useServersStore((s) => s.permissions);
  const fetchPermissions = useServersStore((s) => s.fetchPermissions);
  const currentUser = useAuthStore((s) => s.user);
  const unreadCounts = useUnreadStore((s) => s.counts);
  const isOwner = currentUser?.id === server.owner_id;
  const permsVal = myPerms[server.id] ?? 0;
  const canManageChannels = isOwner || hasPermission(permsVal, MANAGE_CHANNELS);
  const canAccessSettings = isOwner || hasPermission(permsVal, MANAGE_CHANNELS) || hasPermission(permsVal, MANAGE_ROLES);
  const serverChannels = channels[server.id] ?? [];
  const serverCategories = categories[server.id] ?? [];
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [categoryMenu, setCategoryMenu] = useState<{ categoryId: string; x: number; y: number } | null>(null);
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [createInCategory, setCreateInCategory] = useState<string | null>(null);
  const [mutedChannels, setMutedChannels] = useState<Map<string, boolean>>(new Map());
  const [channelMenu, setChannelMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);
  const updateCategory = useServersStore((s) => s.updateCategory);
  const deleteCategory = useServersStore((s) => s.deleteCategory);
  const leaveServer = useServersStore((s) => s.leaveServer);
  const reorderChannels = useServersStore((s) => s.reorderChannels);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const voiceParticipants = useVoiceStore((s) => s.participants);
  const userCacheRef = useRef<Record<string, User>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback((channelList: Channel[], event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = channelList.map((c) => c.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(channelList, oldIndex, newIndex);
    const positions = reordered.map((ch, i) => ({ id: ch.id, position: i }));
    reorderChannels(server.id, positions);
  }, [reorderChannels, server.id]);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([
        fetchChannels(server.id),
        fetchCategories(server.id),
        fetchPermissions(server.id),
      ]);
    } catch (e) {
      setError((e as Error).message || 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, [fetchChannels, fetchCategories, fetchPermissions, server.id]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Fetch notification settings on mount to determine muted channels
  useEffect(() => {
    api.getNotificationSettings().then((settings) => {
      const map = new Map<string, boolean>();
      for (const s of settings) {
        if (s.target_type === 'channel' && s.muted) {
          map.set(s.target_id, true);
        }
      }
      setMutedChannels(map);
    }).catch(() => {});
  }, []);

  const handleToggleMute = async (chId: string) => {
    const currentlyMuted = mutedChannels.get(chId) ?? false;
    const newMuted = !currentlyMuted;
    // Optimistic update
    setMutedChannels((prev) => {
      const next = new Map(prev);
      if (newMuted) next.set(chId, true);
      else next.delete(chId);
      return next;
    });
    setChannelMenu(null);
    try {
      await api.updateNotificationSetting('channel', chId, { muted: newMuted });
    } catch {
      // Revert on failure
      setMutedChannels((prev) => {
        const next = new Map(prev);
        if (currentlyMuted) next.set(chId, true);
        else next.delete(chId);
        return next;
      });
    }
  };

  const handleChannelContextMenu = (chId: string, e: React.MouseEvent) => {
    e.preventDefault();
    const maxX = window.innerWidth - 180;
    const maxY = window.innerHeight - 100;
    setChannelMenu({ channelId: chId, x: Math.min(e.clientX, maxX), y: Math.min(e.clientY, maxY) });
  };

  // Group channels by category
  const { categorizedGroups, uncategorizedText, uncategorizedVoice } = useMemo(() => {
    const textChannels = serverChannels.filter((c) => c.kind === 'text');
    const voiceChannels = serverChannels.filter((c) => c.kind === 'voice');

    const groups: Array<{ category: Category; text: Channel[]; voice: Channel[] }> = [];
    for (const cat of serverCategories) {
      groups.push({
        category: cat,
        text: textChannels.filter((c) => c.category_id === cat.id).sort((a, b) => a.position - b.position),
        voice: voiceChannels.filter((c) => c.category_id === cat.id).sort((a, b) => a.position - b.position),
      });
    }

    return {
      categorizedGroups: groups,
      uncategorizedText: textChannels.filter((c) => !c.category_id).sort((a, b) => a.position - b.position),
      uncategorizedVoice: voiceChannels.filter((c) => !c.category_id).sort((a, b) => a.position - b.position),
    };
  }, [serverChannels, serverCategories]);

  const handleCategoryContextMenu = (categoryId: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (!canManageChannels) return;
    const maxX = window.innerWidth - 180;
    const maxY = window.innerHeight - 100;
    setCategoryMenu({ categoryId, x: Math.min(e.clientX, maxX), y: Math.min(e.clientY, maxY) });
  };

  const [editCategorySaving, setEditCategorySaving] = useState(false);
  const handleEditCategory = async () => {
    if (!editCategoryId || !editCategoryName.trim() || editCategorySaving) return;
    setEditCategorySaving(true);
    try {
      await updateCategory(editCategoryId, server.id, { name: editCategoryName.trim() });
      setEditCategoryId(null);
    } catch (e) {
      console.warn('Failed to edit category:', e);
      setError((e as Error).message || 'Failed to edit category');
    } finally {
      setEditCategorySaving(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryId) return;
    try {
      await deleteCategory(deleteCategoryId, server.id);
      setDeleteCategoryId(null);
    } catch (e) {
      console.warn('Failed to delete category:', e);
      setError((e as Error).message || 'Failed to delete category');
    }
  };

  // Dropdown keyboard navigation
  useEffect(() => {
    if (!showDropdown) return;
    requestAnimationFrame(() => {
      const items = dropdownRef.current?.querySelectorAll<HTMLElement>('button');
      items?.[0]?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowDropdown(false); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const items = dropdownRef.current?.querySelectorAll<HTMLElement>('button');
        if (!items || items.length === 0) return;
        const current = document.activeElement as HTMLElement;
        const idx = Array.from(items).indexOf(current);
        let next = 0;
        if (e.key === 'ArrowDown') next = idx < items.length - 1 ? idx + 1 : 0;
        else if (e.key === 'ArrowUp') next = idx > 0 ? idx - 1 : items.length - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        items[next]?.focus();
      }
      if (e.key === 'Tab') { e.preventDefault(); setShowDropdown(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDropdown]);

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Server header with dropdown */}
      <div className="h-14 px-4 flex items-center border-b border-divider shrink-0 relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          aria-expanded={showDropdown}
          aria-label={`${server.name} server menu`}
          className="flex items-center gap-1 flex-1 min-w-0 hover:bg-white/5 -mx-1 px-1 py-1 rounded"
        >
          <h2 className="text-text-primary font-semibold text-[15px] truncate">
            {server.name}
          </h2>
          <svg className={`w-4 h-4 text-text-muted shrink-0 transition-transform ${showDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {canManageChannels && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-text-secondary hover:text-text-primary"
            title="Create Channel"
            aria-label="Create Channel"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}

        {/* Dropdown menu */}
        {showDropdown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
            <div ref={dropdownRef} role="menu" className="absolute left-2 right-2 top-12 z-50 bg-surface border border-divider rounded-lg shadow-lg py-1 animate-dropdown-enter">
              {canAccessSettings && (
                <button
                  role="menuitem"
                  onClick={() => { setShowDropdown(false); setShowSettings(true); }}
                  className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Server Settings
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => { setShowDropdown(false); setShowInvite(true); }}
                className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                Invite People
              </button>
              {canManageChannels && (
                <button
                  role="menuitem"
                  onClick={() => { setShowDropdown(false); setShowCreateCategory(true); }}
                  className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Create Category
                </button>
              )}
              {!isOwner && (
                <button
                  role="menuitem"
                  onClick={() => { setShowDropdown(false); setShowLeaveConfirm(true); }}
                  className="w-full px-3 py-2 text-left text-sm text-error hover:bg-error/10 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Leave Server
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2 min-h-0">
        {loading && !serverChannels.length && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
          </div>
        )}

        {error && (
          <div className="px-2 py-4 text-center">
            <p className="text-error text-sm mb-2">{error}</p>
            <button onClick={loadChannels} className="text-sm text-primary hover:text-primary-hover">Retry</button>
          </div>
        )}

        {!loading && !error && serverChannels.length === 0 && (
          <div className="px-2 py-4 text-center text-text-muted text-sm">
            No channels yet. Create one with the + button above.
          </div>
        )}

        {/* Uncategorized channels */}
        {uncategorizedText.length > 0 && (
          <ChannelGroup
            channels={uncategorizedText}
            channelId={channelId}
            serverId={server.id}
            unreadCounts={unreadCounts}
            canManage={canManageChannels}
            onChannelSelect={onChannelSelect}
            onEditChannel={setEditChannel}
            mutedChannels={mutedChannels}
            onChannelContextMenu={handleChannelContextMenu}
            canDrag={canManageChannels}
            onDragEnd={(event) => handleDragEnd(uncategorizedText, event)}
            sensors={sensors}
          />
        )}

        {uncategorizedVoice.length > 0 && (
          <VoiceChannelGroup
            channels={uncategorizedVoice}
            serverId={server.id}
            voiceChannelId={voiceChannelId}
            voiceParticipants={voiceParticipants}
            canManage={canManageChannels}
            onEditChannel={setEditChannel}
            userCacheRef={userCacheRef}
            onChannelSelect={onChannelSelect}
          />
        )}

        {/* Categorized channels */}
        {categorizedGroups.map(({ category, text, voice }) => {
          if (text.length === 0 && voice.length === 0 && !canManageChannels) return null;
          const collapsed = collapsedCategories.has(category.id);

          return (
            <div key={category.id} className="mb-1">
              <button
                onClick={() => toggleCategory(category.id)}
                onContextMenu={(e) => handleCategoryContextMenu(category.id, e)}
                aria-expanded={!collapsed}
                aria-label={`${category.name} category`}
                className="w-full px-1 py-1 text-[11px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-0.5 hover:text-text-secondary group"
              >
                <svg className={`w-3 h-3 transition-transform ${collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                <span className="truncate flex-1 text-left">{category.name}</span>
                {canManageChannels && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setCreateInCategory(category.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setCreateInCategory(category.id); } }}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-text-primary"
                    title="Create Channel"
                    aria-label={`Create channel in ${category.name}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </span>
                )}
              </button>

              {!collapsed && (
                <>
                  <ChannelGroup
                    channels={text}
                    channelId={channelId}
                    serverId={server.id}
                    unreadCounts={unreadCounts}
                    canManage={canManageChannels}
                    onChannelSelect={onChannelSelect}
                    onEditChannel={setEditChannel}
                    mutedChannels={mutedChannels}
                    onChannelContextMenu={handleChannelContextMenu}
                    canDrag={canManageChannels}
                    onDragEnd={(event) => handleDragEnd(text, event)}
                    sensors={sensors}
                  />
                  <VoiceChannelGroup
                    channels={voice}
                    serverId={server.id}
                    voiceChannelId={voiceChannelId}
                    voiceParticipants={voiceParticipants}
                    canManage={canManageChannels}
                    onEditChannel={setEditChannel}
                    userCacheRef={userCacheRef}
                    onChannelSelect={onChannelSelect}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Category context menu */}
      {categoryMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCategoryMenu(null)} />
          <div
            className="fixed z-50 bg-surface border border-divider rounded-lg shadow-xl py-1 min-w-[160px] animate-dropdown-enter"
            style={{ left: categoryMenu.x, top: categoryMenu.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary text-left"
              onClick={() => {
                const cat = serverCategories.find((c) => c.id === categoryMenu.categoryId);
                setEditCategoryName(cat?.name ?? '');
                setEditCategoryId(categoryMenu.categoryId);
                setCategoryMenu(null);
              }}
            >
              Edit Category
            </button>
            <button
              className="w-full px-3 py-1.5 text-sm text-error hover:bg-error/10 text-left"
              onClick={() => {
                setDeleteCategoryId(categoryMenu.categoryId);
                setCategoryMenu(null);
              }}
            >
              Delete Category
            </button>
          </div>
        </>
      )}

      {/* Channel context menu (mute/unmute) */}
      {channelMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setChannelMenu(null)} />
          <div
            className="fixed z-50 bg-surface border border-divider rounded-lg shadow-xl py-1 min-w-[160px] animate-dropdown-enter"
            style={{ left: channelMenu.x, top: channelMenu.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary text-left flex items-center gap-2"
              onClick={() => handleToggleMute(channelMenu.channelId)}
            >
              {mutedChannels.get(channelMenu.channelId) ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  Unmute Channel
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                  </svg>
                  Mute Channel
                </>
              )}
            </button>
          </div>
        </>
      )}

      {/* Edit category dialog */}
      {editCategoryId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={() => setEditCategoryId(null)}>
          <div className="bg-surface rounded-lg p-6 w-[400px] max-w-[90vw] animate-modal-scale" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-text-primary text-lg font-semibold mb-4">Edit Category</h3>
            <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Category Name</label>
            <input
              value={editCategoryName}
              onChange={(e) => setEditCategoryName(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleEditCategory()}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditCategoryId(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
              <button onClick={handleEditCategory} disabled={editCategorySaving} className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50">{editCategorySaving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete category confirm */}
      {deleteCategoryId && (
        <ConfirmDialog
          title="Delete Category"
          message="Are you sure you want to delete this category? Channels in it will become uncategorized."
          confirmLabel="Delete"
          danger
          onConfirm={handleDeleteCategory}
          onCancel={() => setDeleteCategoryId(null)}
        />
      )}

      {/* Create channel in specific category */}
      {createInCategory && (
        <CreateChannelDialog
          serverId={server.id}
          categories={serverCategories}
          defaultCategoryId={createInCategory}
          onClose={() => setCreateInCategory(null)}
        />
      )}

      {showCreate && <CreateChannelDialog serverId={server.id} categories={serverCategories} onClose={() => setShowCreate(false)} />}
      {showCreateCategory && <CreateCategoryDialog serverId={server.id} onClose={() => setShowCreateCategory(false)} />}
      {showSettings && <ServerSettingsDialog server={server} onClose={() => setShowSettings(false)} />}
      {showInvite && <InviteDialog serverId={server.id} onClose={() => setShowInvite(false)} />}
      {editChannel && <EditChannelDialog channel={editChannel} serverId={server.id} onClose={() => setEditChannel(null)} />}
      {showLeaveConfirm && (
        <ConfirmDialog
          title="Leave Server"
          message={`Are you sure you want to leave "${server.name}"?`}
          confirmLabel="Leave"
          danger
          onConfirm={async () => {
            setShowLeaveConfirm(false);
            try {
              await leaveServer(server.id);
              navigate('/');
            } catch (e) {
              setError((e as Error).message || 'Failed to leave server');
            }
          }}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function ChannelGroup({
  channels,
  channelId,
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
}: {
  channels: Channel[];
  channelId?: string;
  serverId: string;
  unreadCounts: Record<string, number>;
  canManage: boolean;
  onChannelSelect?: () => void;
  onEditChannel: (ch: Channel) => void;
  mutedChannels: Map<string, boolean>;
  onChannelContextMenu: (channelId: string, e: React.MouseEvent) => void;
  canDrag?: boolean;
  onDragEnd?: (event: DragEndEvent) => void;
  sensors?: ReturnType<typeof useSensors>;
}) {
  if (channels.length === 0) return null;

  const items = channels.map((ch) => {
    const unread = unreadCounts[ch.id] ?? 0;
    const isMuted = mutedChannels.get(ch.id) ?? false;
    return (
      <SortableChannelItem key={ch.id} id={ch.id} disabled={!canDrag}>
        <div className="group flex items-center min-w-0">
          <Link
            to={`/servers/${serverId}/channels/${ch.id}`}
            onClick={() => onChannelSelect?.()}
            onContextMenu={(e) => onChannelContextMenu(ch.id, e)}
            className={`flex-1 min-w-0 px-2 py-1.5 rounded text-left flex items-center gap-1.5 text-sm cursor-pointer transition-colors no-underline ${
              channelId === ch.id
                ? 'bg-text-primary/10 text-text-primary'
                : !isMuted && unread > 0
                  ? 'text-text-primary font-semibold'
                  : 'text-text-secondary hover:bg-text-primary/5 hover:text-text-primary'
            }`}
          >
            <span className="text-text-muted">#</span>
            <span className="truncate flex-1">{ch.name}</span>
            {isMuted && (
              <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
            )}
            {!isMuted && unread > 0 && channelId !== ch.id && (
              <span className="min-w-[18px] h-[18px] bg-error rounded-full flex items-center justify-center px-1 shrink-0">
                <span className="text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>
              </span>
            )}
          </Link>
          {canManage && (
            <button
              onClick={() => onEditChannel(ch)}
              className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-text-primary shrink-0"
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
      </SortableChannelItem>
    );
  });

  if (canDrag && onDragEnd && sensors) {
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={(e) => { channelDragLock = true; onDragEnd(e); }}>
        <SortableContext items={channels.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {items}
        </SortableContext>
      </DndContext>
    );
  }

  return <>{items}</>;
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
}: {
  channels: Channel[];
  serverId: string;
  voiceChannelId: string | null;
  voiceParticipants: Array<{ userId: string; isMuted: boolean; isSpeaking: boolean }>;
  canManage: boolean;
  onEditChannel: (ch: Channel) => void;
  userCacheRef: React.RefObject<Record<string, User>>;
  onChannelSelect?: () => void;
}) {
  if (channels.length === 0) return null;

  return (
    <>
      {channels.map((ch) => {
        const isActive = voiceChannelId === ch.id;
        const channelParticipants = isActive ? voiceParticipants : [];
        return (
          <div key={ch.id}>
            <div className="group flex items-center min-w-0">
              <Link
                to={`/servers/${serverId}/channels/${ch.id}`}
                onClick={() => onChannelSelect?.()}
                className={`flex-1 min-w-0 px-2 py-1.5 rounded text-left flex items-center gap-1.5 text-sm cursor-pointer transition-colors no-underline ${
                  isActive
                    ? 'bg-text-primary/10 text-text-primary'
                    : 'text-text-secondary hover:bg-text-primary/5 hover:text-text-primary'
                }`}
              >
                <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                <span className="truncate">{ch.name}</span>
              </Link>
              {canManage && (
                <button
                  onClick={() => onEditChannel(ch)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-text-primary shrink-0"
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
        <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={20} />
      </div>
      <span className="text-[12px] text-text-secondary truncate">{user?.username ?? '...'}</span>
      {participant.isMuted && (
        <svg className="w-3 h-3 text-error shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

function CreateChannelDialog({ serverId, categories, defaultCategoryId, onClose }: { serverId: string; categories: Category[]; defaultCategoryId?: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('text');
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const createChannel = useServersStore((s) => s.createChannel);
  const navigate = useNavigate();

  const handleCreate = async () => {
    const formatted = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
    if (!formatted) {
      setError('Channel name is required');
      return;
    }
    setLoading(true);
    try {
      const ch = await createChannel(serverId, formatted, kind, undefined, categoryId || undefined);
      onClose();
      if (kind === 'text') {
        navigate(`/servers/${serverId}/channels/${ch.id}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-surface rounded-lg p-6 w-[440px] max-w-[90vw] animate-modal-scale" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-text-primary text-lg font-semibold mb-4">Create Channel</h3>
        {error && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{error}</div>}

        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Channel Type</label>
        <div className="flex gap-2 mt-1 mb-4">
          {['text', 'voice'].map((t) => (
            <button
              key={t}
              onClick={() => setKind(t)}
              className={`px-4 py-2 rounded text-sm capitalize ${
                kind === t ? 'bg-primary text-white' : 'bg-input text-text-secondary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Channel Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="new-channel"
          className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm mb-4"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />

        {categories.length > 0 && (
          <>
            <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm mb-4"
            >
              <option value="">No Category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateCategoryDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const createCategory = useServersStore((s) => s.createCategory);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Category name is required');
      return;
    }
    setLoading(true);
    try {
      await createCategory(serverId, name.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div className="bg-surface rounded-lg p-6 w-[440px] max-w-[90vw] animate-modal-scale" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-text-primary text-lg font-semibold mb-4">Create Category</h3>
        {error && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{error}</div>}

        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Category Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="General"
          className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
