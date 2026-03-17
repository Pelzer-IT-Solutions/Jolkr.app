import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useServersStore } from '../stores/servers';
import { useAuthStore } from '../stores/auth';
import { useUnreadStore } from '../stores/unread';
import Spinner from './ui/Spinner';
import Input from './ui/Input';
import Button from './ui/Button';
import Modal from './ui/Modal';
import EmptyState from './ui/EmptyState';
import { Hash } from 'lucide-react';
import { useVoiceStore } from '../stores/voice';
import type { Channel, Server, User, Category } from '../api/types';
import { hasPermission, MANAGE_CHANNELS, MANAGE_ROLES } from '../utils/permissions';
import * as api from '../api/client';
import ServerSettingsDialog from './dialogs/ServerSettingsDialog';
import EditChannelDialog from './dialogs/EditChannelDialog';
import InviteDialog from './dialogs/InviteDialog';
import ConfirmDialog from './dialogs/ConfirmDialog';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import CategoryGroup, { TextChannelGroup, VoiceChannelGroup } from './CategoryGroup';
import { ChevronDown, Plus, Settings, UserPlus, FolderPlus, LogOut } from 'lucide-react';
import { useContextMenuStore } from '../stores/context-menu';

export interface ChannelListProps {
  server: Server;
  onChannelSelect?: () => void;
}

export default function ChannelList({ server, onChannelSelect }: ChannelListProps) {
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
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [createInCategory, setCreateInCategory] = useState<string | null>(null);
  const [mutedChannels, setMutedChannels] = useState<Map<string, boolean>>(new Map());
  const updateCategory = useServersStore((s) => s.updateCategory);
  const deleteCategory = useServersStore((s) => s.deleteCategory);
  const leaveServer = useServersStore((s) => s.leaveServer);
  const reorderChannels = useServersStore((s) => s.reorderChannels);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const voiceParticipants = useVoiceStore((s) => s.participants);
  const userCacheRef = useRef<Record<string, User>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Drag lock ref — replaces module-level `channelDragLock` variable
  const dragLockRef = useRef(false);

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
    }).catch(() => { });
  }, []);

  const handleToggleMute = useCallback(async (chId: string) => {
    const currentlyMuted = mutedChannels.get(chId) ?? false;
    const newMuted = !currentlyMuted;
    // Optimistic update
    setMutedChannels((prev) => {
      const next = new Map(prev);
      if (newMuted) next.set(chId, true);
      else next.delete(chId);
      return next;
    });
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
  }, [mutedChannels]);

  const handleChannelContextMenu = useCallback((chId: string, e: React.MouseEvent) => {
    e.preventDefault();
    const isMuted = mutedChannels.get(chId) ?? false;
    useContextMenuStore.getState().open(e.clientX, e.clientY, [
      {
        label: isMuted ? 'Unmute Channel' : 'Mute Channel',
        icon: isMuted ? 'Bell' : 'BellOff',
        onClick: () => handleToggleMute(chId),
      },
    ]);
  }, [mutedChannels, handleToggleMute]);

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

  const handleCategoryContextMenu = useCallback((categoryId: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (!canManageChannels) return;
    useContextMenuStore.getState().open(e.clientX, e.clientY, [
      {
        label: 'Edit Category', icon: 'Pencil', onClick: () => {
          const cat = (useServersStore.getState().categories[server.id] ?? []).find((c) => c.id === categoryId);
          setEditCategoryName(cat?.name ?? '');
          setEditCategoryId(categoryId);
        },
      },
      {
        label: 'Delete Category', icon: 'Trash2', variant: 'danger', onClick: () => {
          setDeleteCategoryId(categoryId);
        },
      },
    ]);
  }, [canManageChannels, server.id]);

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

  const toggleCategory = useCallback((categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }, []);

  const handleCreateInCategory = useCallback((categoryId: string) => {
    setCreateInCategory(categoryId);
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Server header with dropdown */}
      <div className="h-17 px-4 gap-2 flex items-center border-b border-divider shrink-0 relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          aria-expanded={showDropdown}
          aria-label={`${server.name} server menu`}
          className="flex items-center justify-between gap-1 flex-1 min-w-0 hover:bg-hover -mx-1 px-3 py-2 rounded-lg"
        >
          <h2 className="text-text-primary font-semibold text-base truncate">
            {server.name}
          </h2>
          <ChevronDown className={`size-4 text-text-tertiary shrink-0 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </button>
        {canManageChannels && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-text-secondary hover:text-text-primary"
            title="Create Channel"
            aria-label="Create Channel"
          >
            <Plus className="size-5" />
          </button>
        )}

        {/* Dropdown menu */}
        {showDropdown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
            <div ref={dropdownRef} role="menu" className="absolute left-2 right-2 top-12 z-50 bg-surface border border-divider rounded-lg shadow-float py-1 animate-dropdown-enter">
              {canAccessSettings && (
                <button
                  role="menuitem"
                  onClick={() => { setShowDropdown(false); setShowSettings(true); }}
                  className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-hover hover:text-text-primary flex items-center gap-2"
                >
                  <Settings className="size-4" />
                  Server Settings
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => { setShowDropdown(false); setShowInvite(true); }}
                className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-hover hover:text-text-primary flex items-center gap-2"
              >
                <UserPlus className="size-4" />
                Invite People
              </button>
              {canManageChannels && (
                <button
                  role="menuitem"
                  onClick={() => { setShowDropdown(false); setShowCreateCategory(true); }}
                  className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-hover hover:text-text-primary flex items-center gap-2"
                >
                  <FolderPlus className="size-4" />
                  Create Category
                </button>
              )}
              {!isOwner && (
                <button
                  role="menuitem"
                  onClick={() => { setShowDropdown(false); setShowLeaveConfirm(true); }}
                  className="w-full px-3 py-2 text-left text-sm text-danger hover:bg-danger/10 flex items-center gap-2"
                >
                  <LogOut className="size-4" />
                  Leave Server
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-3 min-h-0">
        {loading && !serverChannels.length && (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        )}

        {error && (
          <div className="px-2 py-4 text-center">
            <p className="text-danger text-sm mb-2">{error}</p>
            <button onClick={loadChannels} className="text-sm text-accent hover:text-accent-hover">Retry</button>
          </div>
        )}

        {!loading && !error && serverChannels.length === 0 && (
          <EmptyState
            icon={<Hash className="size-8" />}
            title="No channels yet."
            description="Create one with the + button above."
          />
        )}

        {/* Uncategorized channels */}
        {uncategorizedText.length > 0 && (
          <TextChannelGroup
            channels={uncategorizedText}
            activeChannelId={channelId}
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
            dragLockRef={dragLockRef}
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
            dragLockRef={dragLockRef}
          />
        )}

        {/* Categorized channels */}
        {categorizedGroups.map(({ category, text, voice }) => {
          if (text.length === 0 && voice.length === 0 && !canManageChannels) return null;

          return (
            <CategoryGroup
              key={category.id}
              category={category}
              textChannels={text}
              voiceChannels={voice}
              serverId={server.id}
              activeChannelId={channelId}
              unreadCounts={unreadCounts}
              voiceChannelId={voiceChannelId}
              voiceParticipants={voiceParticipants}
              mutedChannels={mutedChannels}
              canManage={canManageChannels}
              onChannelSelect={onChannelSelect}
              onEditChannel={setEditChannel}
              onChannelContextMenu={handleChannelContextMenu}
              onCategoryContextMenu={handleCategoryContextMenu}
              onCreateInCategory={handleCreateInCategory}
              collapsed={collapsedCategories.has(category.id)}
              onToggleCollapse={toggleCategory}
              onTextDragEnd={(event) => handleDragEnd(text, event)}
              sensors={sensors}
              userCacheRef={userCacheRef}
              dragLockRef={dragLockRef}
            />
          );
        })}
      </div>

      {/* Edit category dialog */}
      {editCategoryId && (
        <Modal open onClose={() => setEditCategoryId(null)} className="p-8 w-100 max-w-[90vw]">
            <h3 className="text-text-primary text-lg font-semibold mb-4">Edit Category</h3>
            <Input
              label="Category Name"
              value={editCategoryName}
              onChange={(e) => setEditCategoryName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleEditCategory()}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditCategoryId(null)} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
              <Button onClick={handleEditCategory} disabled={editCategorySaving}>
                {editCategorySaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
        </Modal>
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

// ── Sub-components (dialogs kept in ChannelList) ──────────────────────────

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
    <Modal open onClose={onClose} className="p-8 w-110 max-w-[90vw]">
        <h3 className="text-text-primary text-lg font-semibold mb-4">Create Channel</h3>
        {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded mb-3">{error}</div>}

        <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Channel Type</label>
        <div className="flex gap-2 mt-1 mb-4">
          {['text', 'voice'].map((t) => (
            <button
              key={t}
              onClick={() => setKind(t)}
              className={`px-4 py-2 rounded text-sm capitalize ${kind === t ? 'bg-accent text-white' : 'bg-surface text-text-secondary'
                }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <Input
            label="Channel Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="new-channel"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>

        {categories.length > 0 && (
          <>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full mt-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm mb-4"
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
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : 'Create'}
          </Button>
        </div>
    </Modal>
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
    <Modal open onClose={onClose} className="p-8 w-110 max-w-[90vw]">
        <h3 className="text-text-primary text-lg font-semibold mb-4">Create Category</h3>
        {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded mb-3">{error}</div>}

        <Input
          label="Category Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="General"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : 'Create'}
          </Button>
        </div>
    </Modal>
  );
}
