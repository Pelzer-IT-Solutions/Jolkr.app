import { create } from 'zustand';
import * as api from '../api/client';
import { wsClient } from '../api/ws';
import { useAuthStore } from './auth';
import { useUsersStore } from './users';
import type { Server as GeneratedServer } from '../api/generated/Server';
import type { Server, ServerThemeData, Channel, ChannelKind, Member, Role, Category, ServerEmoji } from '../api/types';

/** Push embedded user objects from a member list into the global users cache
 *  so non-server surfaces (typing indicator, profile cards in DMs) can resolve
 *  display names by `user_id` without re-fetching. */
function indexMemberUsers(members: Member[]): void {
  const users = members.map((m) => m.user).filter((u): u is NonNullable<Member['user']> => Boolean(u));
  if (users.length) useUsersStore.getState().upsertUsers(users);
}

/** Wire `Server.theme` is `JsonValue`; the FE overlay (`Server.theme:
 *  ServerThemeData | null`) carries the typed shape. Guard against
 *  array/primitive payloads at the boundary. */
function normalizeServer(raw: GeneratedServer): Server {
  const t = raw.theme;
  const theme: ServerThemeData | null =
    t != null && typeof t === 'object' && !Array.isArray(t)
      ? (t as unknown as ServerThemeData)
      : null;
  return { ...raw, theme };
}

interface ServersState {
  servers: Server[];
  channels: Record<string, Channel[]>;
  members: Record<string, Member[]>;
  /**
   * Members visible to the active channel (post role + overwrite filtering).
   * Keyed by channel id. Populated via `fetchChannelMembers`. The server-wide
   * `members` map stays the source of truth for moderator views and lookups
   * across panels — this map only gates the in-channel member panel.
   */
  channelMembers: Record<string, Member[]>;
  categories: Record<string, Category[]>;
  roles: Record<string, Role[]>;
  permissions: Record<string, number>;
  channelPermissions: Record<string, number>;
  emojis: Record<string, ServerEmoji[]>;
  isLoading: boolean;
  fetchServers: () => Promise<void>;
  fetchChannels: (serverId: string) => Promise<void>;
  fetchMembers: (serverId: string) => Promise<void>;
  fetchChannelMembers: (channelId: string) => Promise<void>;
  fetchCategories: (serverId: string) => Promise<void>;
  fetchRoles: (serverId: string) => Promise<void>;
  fetchPermissions: (serverId: string) => Promise<void>;
  fetchChannelPermissions: (channelId: string) => Promise<void>;
  fetchMembersWithRoles: (serverId: string) => Promise<void>;
  createServer: (name: string, description?: string) => Promise<Server>;
  createChannel: (serverId: string, name: string, kind: ChannelKind, categoryId?: string) => Promise<Channel>;
  updateServer: (id: string, body: { name?: string; description?: string; icon_url?: string }) => Promise<Server>;
  updateChannel: (id: string, serverId: string, body: { name?: string; topic?: string; category_id?: string; is_nsfw?: boolean; slowmode_seconds?: number }) => Promise<Channel>;
  deleteServer: (id: string) => Promise<void>;
  deleteChannel: (id: string, serverId: string) => Promise<void>;
  moveChannels: (serverId: string, items: api.ChannelMoveItem[]) => Promise<void>;
  reorderServers: (serverIds: string[]) => Promise<void>;
  leaveServer: (id: string) => Promise<void>;
  createCategory: (serverId: string, name: string) => Promise<Category>;
  updateCategory: (id: string, serverId: string, body: { name?: string; position?: number }) => Promise<Category>;
  deleteCategory: (id: string, serverId: string) => Promise<void>;
  reorderCategories: (serverId: string, positions: Array<{ id: string; position: number }>) => Promise<void>;
  createRole: (serverId: string, body: { name: string; color?: number; permissions?: number }) => Promise<Role>;
  updateRole: (id: string, serverId: string, body: { name?: string; color?: number; position?: number; permissions?: number }) => Promise<Role>;
  deleteRole: (id: string, serverId: string) => Promise<void>;
  assignRole: (serverId: string, roleId: string, userId: string) => Promise<void>;
  removeRole: (serverId: string, roleId: string, userId: string) => Promise<void>;
  fetchEmojis: (serverId: string) => Promise<void>;
  /** Apply a Role CRUD WS event to roles[serverId] and drop permission +
   *  channel-member caches that may now be stale. UI-side refetches stay in
   *  the WS subscriber — this action only owns the store mutation. */
  applyRoleChange: (
    serverId: string,
    change: { op: 'RoleCreate' | 'RoleUpdate'; role: Role } | { op: 'RoleDelete'; role_id: string },
  ) => void;
  /** Drop the cached channelPermissions for this channel so a subsequent
   *  fetchChannelPermissions yields fresh data. */
  applyChannelPermissionUpdate: (channelId: string) => void;
  /** Patch every server's members[].user blob where user_id matches, so
   *  MemberPanels across servers reflect rename/avatar/status updates from
   *  a single WS UserUpdate event. */
  patchMemberUser: (
    userId: string,
    patch: Partial<Pick<NonNullable<Member['user']>, 'display_name' | 'avatar_url' | 'bio' | 'status' | 'banner_color'>>,
  ) => void;
  reset: () => void;
}

/** Remove all cached state for a server (channels, members, categories, roles, permissions, emojis). */
function removeServerState(serverId: string, state: ServersState) {
  const channelIds = (state.channels[serverId] ?? []).map((c) => c.id);
  const { [serverId]: _ch, ...restChannels } = state.channels;
  const { [serverId]: _mem, ...restMembers } = state.members;
  const { [serverId]: _cat, ...restCategories } = state.categories;
  const { [serverId]: _rol, ...restRoles } = state.roles;
  const { [serverId]: _perm, ...restPermissions } = state.permissions;
  const { [serverId]: _emo, ...restEmojis } = state.emojis;
  const chPerms = { ...state.channelPermissions };
  const chMembers = { ...state.channelMembers };
  for (const cid of channelIds) {
    delete chPerms[cid];
    delete chMembers[cid];
  }
  return {
    servers: state.servers.filter((s) => s.id !== serverId),
    channels: restChannels,
    members: restMembers,
    channelMembers: chMembers,
    categories: restCategories,
    roles: restRoles,
    permissions: restPermissions,
    channelPermissions: chPerms,
    emojis: restEmojis,
  };
}

export const useServersStore = create<ServersState>((set, get) => ({
  servers: [],
  channels: {},
  members: {},
  channelMembers: {},
  categories: {},
  roles: {},
  permissions: {},
  channelPermissions: {},
  emojis: {},
  isLoading: false,

  fetchServers: async () => {
    // Only show loading spinner on initial fetch — refetches update silently
    if (!get().servers.length) set({ isLoading: true });
    try {
      const servers = await api.getServers();
      set({ servers, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchChannels: async (serverId) => {
    try {
      const channels = await api.getChannels(serverId);
      set({ channels: { ...get().channels, [serverId]: channels } });
    } catch (e) {
      console.warn('Failed to fetch channels:', e);
    }
  },

  fetchMembers: async (serverId) => {
    try {
      // Use enriched endpoint — includes full User objects with avatar_url
      const members = await api.getMembersWithRoles(serverId);
      set({ members: { ...get().members, [serverId]: members } });
      indexMemberUsers(members);
    } catch (e) {
      console.warn('Failed to fetch members:', e);
    }
  },

  fetchChannelMembers: async (channelId) => {
    try {
      // No skip-if-cached: a role/overwrite mutation must always be able to
      // refresh the visible audience; cache invalidation is by intent here.
      const members = await api.getChannelMembers(channelId);
      set({ channelMembers: { ...get().channelMembers, [channelId]: members } });
      // Endpoint returns lightweight rows (no embedded `user`), so nothing
      // to push into the global users cache from here.
    } catch (e) {
      console.warn('Failed to fetch channel members:', e);
    }
  },

  fetchCategories: async (serverId) => {
    const categories = await api.getCategories(serverId);
    set({ categories: { ...get().categories, [serverId]: categories } });
  },

  fetchRoles: async (serverId) => {
    // Warm-cache skip: WS RoleCreate/Update/Delete events (handled in
    // applyRoleChange) keep the store fresh, so refetching on every panel
    // open is wasted bandwidth. Callers that need a forced refresh can
    // clear the slice first.
    if (get().roles[serverId]) return;
    const roles = await api.getRoles(serverId);
    set({ roles: { ...get().roles, [serverId]: roles } });
  },

  fetchPermissions: async (serverId) => {
    const result = await api.getMyPermissions(serverId);
    set({ permissions: { ...get().permissions, [serverId]: result.permissions } });
  },

  fetchChannelPermissions: async (channelId) => {
    // Skip if already cached
    if (get().channelPermissions[channelId] !== undefined) return;
    try {
      const result = await api.getMyChannelPermissions(channelId);
      set({ channelPermissions: { ...get().channelPermissions, [channelId]: result.permissions } });
    } catch { /* ignore — will use server-level perms as fallback */ }
  },

  fetchMembersWithRoles: async (serverId) => {
    try {
      const members = await api.getMembersWithRoles(serverId);
      set({ members: { ...get().members, [serverId]: members } });
      indexMemberUsers(members);
    } catch (e) {
      console.warn('Failed to fetch members with roles:', e);
    }
  },

  createServer: async (name, description) => {
    const server = await api.createServer({ name, description });
    set({ servers: [...get().servers, server] });
    return server;
  },

  createChannel: async (serverId, name, kind, categoryId) => {
    const channel = await api.createChannel(serverId, { name, kind, category_id: categoryId });
    const current = get().channels[serverId] ?? [];
    if (!current.some((c) => c.id === channel.id)) {
      set({ channels: { ...get().channels, [serverId]: [...current, channel] } });
    }
    return channel;
  },

  updateServer: async (id, body) => {
    const updated = await api.updateServer(id, body);
    set({ servers: get().servers.map((s) => (s.id === id ? updated : s)) });
    return updated;
  },

  updateChannel: async (id, serverId, body) => {
    const updated = await api.updateChannel(id, body);
    const current = get().channels[serverId] ?? [];
    set({ channels: { ...get().channels, [serverId]: current.map((c) => (c.id === id ? updated : c)) } });
    return updated;
  },

  deleteServer: async (id) => {
    await api.deleteServer(id);
    set({ servers: get().servers.filter((s) => s.id !== id) });
  },

  deleteChannel: async (id, serverId) => {
    await api.deleteChannel(id);
    const current = get().channels[serverId] ?? [];
    set({ channels: { ...get().channels, [serverId]: current.filter((c) => c.id !== id) } });
  },

  moveChannels: async (serverId, items) => {
    // Optimistic update. category_id is intentionally tri-state: undefined =
    // keep the existing parent, null = move to uncategorized, string = move
    // into that category.
    const current = get().channels[serverId] ?? [];
    const moveMap = new Map(items.map((i) => [i.id, i]));
    const updated = current.map((ch) => {
      const m = moveMap.get(ch.id);
      if (!m) return ch;
      return {
        ...ch,
        position: m.position,
        ...(m.category_id !== undefined ? { category_id: m.category_id } : {}),
      };
    });
    set({ channels: { ...get().channels, [serverId]: updated } });
    try {
      const channels = await api.moveChannels(serverId, items);
      set({ channels: { ...get().channels, [serverId]: channels } });
    } catch {
      // Revert on failure
      set({ channels: { ...get().channels, [serverId]: current } });
    }
  },

  reorderServers: async (serverIds) => {
    // Optimistic update
    const current = get().servers;
    const idOrder = new Map(serverIds.map((id, i) => [id, i]));
    const sorted = [...current].sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
    set({ servers: sorted });
    try {
      await api.reorderServers(serverIds);
    } catch {
      // Revert on failure
      set({ servers: current });
    }
  },

  leaveServer: async (id) => {
    await api.leaveServer(id);
    set(removeServerState(id, get()));
  },

  // Categories
  createCategory: async (serverId, name) => {
    const category = await api.createCategory(serverId, { name });
    const current = get().categories[serverId] ?? [];
    set({ categories: { ...get().categories, [serverId]: [...current, category] } });
    return category;
  },

  updateCategory: async (id, serverId, body) => {
    const updated = await api.updateCategory(id, body);
    const current = get().categories[serverId] ?? [];
    set({ categories: { ...get().categories, [serverId]: current.map((c) => (c.id === id ? updated : c)) } });
    return updated;
  },

  deleteCategory: async (id, serverId) => {
    await api.deleteCategory(id);
    const current = get().categories[serverId] ?? [];
    set({ categories: { ...get().categories, [serverId]: current.filter((c) => c.id !== id) } });
    // Refetch channels since their category_id may have changed
    get().fetchChannels(serverId);
  },

  reorderCategories: async (serverId, positions) => {
    // Optimistic update
    const current = get().categories[serverId] ?? [];
    const posMap = new Map(positions.map((p) => [p.id, p.position]));
    const updated = current.map((c) => posMap.has(c.id) ? { ...c, position: posMap.get(c.id)! } : c);
    set({ categories: { ...get().categories, [serverId]: updated } });
    try {
      const categories = await api.reorderCategories(serverId, positions);
      set({ categories: { ...get().categories, [serverId]: categories } });
    } catch {
      // Revert on failure
      set({ categories: { ...get().categories, [serverId]: current } });
    }
  },

  // Roles
  createRole: async (serverId, body) => {
    const role = await api.createRole(serverId, body);
    const current = get().roles[serverId] ?? [];
    set({ roles: { ...get().roles, [serverId]: [...current, role] } });
    return role;
  },

  updateRole: async (id, serverId, body) => {
    const updated = await api.updateRole(id, body);
    const current = get().roles[serverId] ?? [];
    set({ roles: { ...get().roles, [serverId]: current.map((r) => (r.id === id ? updated : r)) } });
    return updated;
  },

  deleteRole: async (id, serverId) => {
    await api.deleteRole(id);
    const current = get().roles[serverId] ?? [];
    set({ roles: { ...get().roles, [serverId]: current.filter((r) => r.id !== id) } });
  },

  assignRole: async (serverId, roleId, userId) => {
    await api.assignRole(serverId, roleId, userId);
    // Refetch members to update role_ids
    get().fetchMembersWithRoles(serverId);
  },

  removeRole: async (serverId, roleId, userId) => {
    await api.removeRole(serverId, roleId, userId);
    get().fetchMembersWithRoles(serverId);
  },

  applyRoleChange: (serverId, change) => {
    const state = get();
    const current = state.roles[serverId] ?? [];
    let nextRoles: Role[] = current;
    switch (change.op) {
      case 'RoleCreate': {
        if (!current.some((c) => c.id === change.role.id)) nextRoles = [...current, change.role];
        break;
      }
      case 'RoleUpdate': {
        nextRoles = current.map((c) => (c.id === change.role.id ? change.role : c));
        break;
      }
      case 'RoleDelete': {
        nextRoles = current.filter((c) => c.id !== change.role_id);
        break;
      }
    }
    // Drop server + per-channel permission caches plus visible-member rosters —
    // any of these may shift when role layout changes.
    const { [serverId]: _serverPerm, ...restServerPerms } = state.permissions;
    const channelIds = (state.channels[serverId] ?? []).map((c) => c.id);
    const restChanPerms = { ...state.channelPermissions };
    const restChannelMembers = { ...state.channelMembers };
    for (const cid of channelIds) {
      delete restChanPerms[cid];
      delete restChannelMembers[cid];
    }
    set({
      roles: { ...state.roles, [serverId]: nextRoles },
      permissions: restServerPerms,
      channelPermissions: restChanPerms,
      channelMembers: restChannelMembers,
    });
  },

  applyChannelPermissionUpdate: (channelId) => {
    const state = get();
    if (!(channelId in state.channelPermissions)) return;
    const { [channelId]: _drop, ...rest } = state.channelPermissions;
    set({ channelPermissions: rest });
  },

  patchMemberUser: (userId, patch) => {
    const state = get();
    const nextMembers: Record<string, Member[]> = {};
    let changed = false;
    for (const [sid, list] of Object.entries(state.members)) {
      const idx = list.findIndex((m) => m.user_id === userId);
      if (idx === -1) continue;
      const updatedList = list.slice();
      const m = updatedList[idx];
      updatedList[idx] = {
        ...m,
        user: m.user ? { ...m.user, ...patch } : m.user,
      };
      nextMembers[sid] = updatedList;
      changed = true;
    }
    if (changed) set({ members: { ...state.members, ...nextMembers } });
  },

  reset: () => {
    set({ servers: [], channels: {}, members: {}, channelMembers: {}, categories: {}, roles: {}, permissions: {}, channelPermissions: {}, emojis: {}, isLoading: false });
  },

  fetchEmojis: async (serverId) => {
    // Skip if already cached
    if (get().emojis[serverId]) return;
    try {
      const emojis = await api.getServerEmojis(serverId);
      set({ emojis: { ...get().emojis, [serverId]: emojis } });
    } catch (e) {
      console.warn('Failed to fetch emojis:', e);
    }
  },
}));

const EMPTY_MEMBERS: Member[] = [];
const EMPTY_ROLES: Role[] = [];

/** Selector: members for a specific server */
export const selectServerMembers = (serverId: string) =>
  (s: { members: Record<string, Member[]> }) => s.members[serverId] ?? EMPTY_MEMBERS;

/** Selector: roles for a specific server */
export const selectServerRoles = (serverId: string) =>
  (s: { roles: Record<string, Role[]> }) => s.roles[serverId] ?? EMPTY_ROLES;

// Wire up WebSocket events for server-level changes
wsClient.on((event) => {
  const store = useServersStore.getState();
  switch (event.op) {
    case 'ChannelCreate': {
      const { channel } = event.d;
      if (!channel?.id || !channel?.server_id) break;
      if (!store.servers.some((s) => s.id === channel.server_id)) break;
      const current = store.channels[channel.server_id] ?? [];
      if (!current.some((c) => c.id === channel.id)) {
        useServersStore.setState({
          channels: { ...store.channels, [channel.server_id]: [...current, channel] },
        });
      }
      break;
    }
    case 'ChannelUpdate': {
      const { channel } = event.d;
      if (!channel?.id || !channel?.server_id) break;
      if (!store.servers.some((s) => s.id === channel.server_id)) break;
      const current = store.channels[channel.server_id] ?? [];
      useServersStore.setState({
        channels: {
          ...store.channels,
          [channel.server_id]: current.map((c) => (c.id === channel.id ? channel : c)),
        },
      });
      break;
    }
    case 'ChannelDelete': {
      const { channel_id, server_id } = event.d;
      if (!channel_id || !server_id) break;
      if (!store.servers.some((s) => s.id === server_id)) break;
      const current = store.channels[server_id] ?? [];
      useServersStore.setState({
        channels: { ...store.channels, [server_id]: current.filter((c) => c.id !== channel_id) },
      });
      break;
    }
    case 'MemberJoin': {
      const { server_id, user_id } = event.d;
      if (!server_id) break;
      if (!store.servers.some((s) => s.id === server_id)) {
        // Server not in store yet — if WE just joined, refresh the server list
        const currentUserId = useAuthStore.getState().user?.id;
        if (user_id === currentUserId) {
          useServersStore.getState().fetchServers();
        }
        break;
      }
      store.fetchMembers(server_id).catch(e => console.warn('Failed to fetch members:', e));
      break;
    }
    case 'MemberLeave': {
      const { server_id, user_id } = event.d;
      if (!server_id || !user_id) break;
      if (!store.servers.some((s) => s.id === server_id)) break;
      const current = store.members[server_id] ?? [];
      // Drop the leaver from the per-channel rosters too — channelMembers is
      // a strict subset of `members` so the same filter applies.
      const channelIds = (store.channels[server_id] ?? []).map((c) => c.id);
      const nextChannelMembers = { ...store.channelMembers };
      for (const cid of channelIds) {
        const list = nextChannelMembers[cid];
        if (list) nextChannelMembers[cid] = list.filter((m) => m.user_id !== user_id);
      }
      useServersStore.setState({
        members: { ...store.members, [server_id]: current.filter((m) => m.user_id !== user_id) },
        channelMembers: nextChannelMembers,
      });
      break;
    }
    case 'MemberUpdate': {
      const { server_id, user_id, timeout_until, nickname, role_ids } = event.d;
      if (!server_id || !user_id) break;
      if (!store.servers.some((s) => s.id === server_id)) break;
      const current = store.members[server_id] ?? [];
      const updates: Partial<Pick<Member, 'timeout_until' | 'nickname' | 'role_ids'>> = {};
      if ('timeout_until' in event.d) updates.timeout_until = timeout_until;
      if ('nickname' in event.d) updates.nickname = nickname;
      if ('role_ids' in event.d) updates.role_ids = role_ids ?? undefined;
      const nextMembers = {
        ...store.members,
        [server_id]: current.map((m) =>
          m.user_id === user_id ? { ...m, ...updates } : m
        ),
      };
      // Only invalidate permission caches when the CURRENT user's roles change
      const currentUserId = useAuthStore.getState().user?.id;
      if ('role_ids' in event.d && user_id === currentUserId) {
        const { [server_id]: _p, ...restPerms } = store.permissions;
        const channelIds = (store.channels[server_id] ?? []).map((c) => c.id);
        const restChanPerms = { ...store.channelPermissions };
        for (const cid of channelIds) delete restChanPerms[cid];
        useServersStore.setState({ members: nextMembers, permissions: restPerms, channelPermissions: restChanPerms });
      } else {
        useServersStore.setState({ members: nextMembers });
      }
      break;
    }
    case 'ServerUpdate': {
      const { server } = event.d;
      if (!server?.id) break;
      const overlay = normalizeServer(server);
      useServersStore.setState({
        servers: store.servers.map((s) => (s.id === overlay.id ? overlay : s)),
      });
      break;
    }
    case 'ServerDelete': {
      const { server_id } = event.d;
      if (!server_id) break;
      useServersStore.setState(removeServerState(server_id, store));
      break;
    }
    case 'CategoryCreate': {
      const { category } = event.d;
      if (!category?.id || !category?.server_id) break;
      if (!store.servers.some((s) => s.id === category.server_id)) break;
      const current = store.categories[category.server_id] ?? [];
      if (!current.some((c) => c.id === category.id)) {
        useServersStore.setState({
          categories: { ...store.categories, [category.server_id]: [...current, category] },
        });
      }
      break;
    }
    case 'CategoryUpdate': {
      const { category } = event.d;
      if (!category?.id || !category?.server_id) break;
      if (!store.servers.some((s) => s.id === category.server_id)) break;
      const current = store.categories[category.server_id] ?? [];
      useServersStore.setState({
        categories: {
          ...store.categories,
          [category.server_id]: current.map((c) => (c.id === category.id ? category : c)),
        },
      });
      break;
    }
    case 'CategoryDelete': {
      const { category_id, server_id } = event.d;
      if (!category_id || !server_id) break;
      if (!store.servers.some((s) => s.id === server_id)) break;
      const current = store.categories[server_id] ?? [];
      useServersStore.setState({
        categories: { ...store.categories, [server_id]: current.filter((c) => c.id !== category_id) },
      });
      break;
    }
  }
});
