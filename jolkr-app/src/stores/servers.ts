import { create } from 'zustand';
import type { Server, Channel, ChannelKind, Member, Role, Category, ServerEmoji } from '../api/types';
import * as api from '../api/client';
import { wsClient } from '../api/ws';
import { useAuthStore } from './auth';

interface ServersState {
  servers: Server[];
  channels: Record<string, Channel[]>;
  members: Record<string, Member[]>;
  categories: Record<string, Category[]>;
  roles: Record<string, Role[]>;
  permissions: Record<string, number>;
  channelPermissions: Record<string, number>;
  emojis: Record<string, ServerEmoji[]>;
  loading: boolean;
  fetchServers: () => Promise<void>;
  fetchChannels: (serverId: string) => Promise<void>;
  fetchMembers: (serverId: string) => Promise<void>;
  fetchCategories: (serverId: string) => Promise<void>;
  fetchRoles: (serverId: string) => Promise<void>;
  fetchPermissions: (serverId: string) => Promise<void>;
  fetchChannelPermissions: (channelId: string) => Promise<void>;
  fetchMembersWithRoles: (serverId: string) => Promise<void>;
  createServer: (name: string, description?: string) => Promise<Server>;
  createChannel: (serverId: string, name: string, kind: ChannelKind, topic?: string, categoryId?: string) => Promise<Channel>;
  updateServer: (id: string, body: { name?: string; description?: string; icon_url?: string }) => Promise<Server>;
  updateChannel: (id: string, serverId: string, body: { name?: string; topic?: string; category_id?: string; is_nsfw?: boolean; slowmode_seconds?: number }) => Promise<Channel>;
  deleteServer: (id: string) => Promise<void>;
  deleteChannel: (id: string, serverId: string) => Promise<void>;
  reorderChannels: (serverId: string, positions: Array<{ id: string; position: number }>) => Promise<void>;
  reorderServers: (serverIds: string[]) => Promise<void>;
  leaveServer: (id: string) => Promise<void>;
  createCategory: (serverId: string, name: string) => Promise<Category>;
  updateCategory: (id: string, serverId: string, body: { name?: string; position?: number }) => Promise<Category>;
  deleteCategory: (id: string, serverId: string) => Promise<void>;
  createRole: (serverId: string, body: { name: string; color?: number; permissions?: number }) => Promise<Role>;
  updateRole: (id: string, serverId: string, body: { name?: string; color?: number; position?: number; permissions?: number }) => Promise<Role>;
  deleteRole: (id: string, serverId: string) => Promise<void>;
  assignRole: (serverId: string, roleId: string, userId: string) => Promise<void>;
  removeRole: (serverId: string, roleId: string, userId: string) => Promise<void>;
  fetchEmojis: (serverId: string) => Promise<void>;
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
  for (const cid of channelIds) delete chPerms[cid];
  return {
    servers: state.servers.filter((s) => s.id !== serverId),
    channels: restChannels,
    members: restMembers,
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
  categories: {},
  roles: {},
  permissions: {},
  channelPermissions: {},
  emojis: {},
  loading: false,

  fetchServers: async () => {
    // Only show loading spinner on initial fetch — refetches update silently
    if (!get().servers.length) set({ loading: true });
    try {
      const servers = await api.getServers();
      set({ servers, loading: false });
    } catch {
      set({ loading: false });
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
      const members = await api.getMembersWithRoles(serverId);
      set({ members: { ...get().members, [serverId]: members } });
    } catch (e) {
      console.warn('Failed to fetch members:', e);
    }
  },

  fetchCategories: async (serverId) => {
    const categories = await api.getCategories(serverId);
    set({ categories: { ...get().categories, [serverId]: categories } });
  },

  fetchRoles: async (serverId) => {
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
    } catch (e) {
      console.warn('Failed to fetch members with roles:', e);
    }
  },

  createServer: async (name, description) => {
    const server = await api.createServer({ name, description });
    set({ servers: [...get().servers, server] });
    return server;
  },

  createChannel: async (serverId, name, kind, topic, categoryId) => {
    const channel = await api.createChannel(serverId, { name, kind, topic, category_id: categoryId });
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

  reorderChannels: async (serverId, positions) => {
    // Optimistic update
    const current = get().channels[serverId] ?? [];
    const posMap = new Map(positions.map((p) => [p.id, p.position]));
    const updated = current.map((ch) => posMap.has(ch.id) ? { ...ch, position: posMap.get(ch.id)! } : ch);
    set({ channels: { ...get().channels, [serverId]: updated } });
    try {
      const channels = await api.reorderChannels(serverId, positions);
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

  reset: () => {
    set({ servers: [], channels: {}, members: {}, categories: {}, roles: {}, permissions: {}, channelPermissions: {}, emojis: {}, loading: false });
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

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_MEMBERS: Member[] = [];
const EMPTY_ROLES: Role[] = [];
const EMPTY_CATEGORIES: Category[] = [];

/** Selector: channels for a specific server */
export const selectServerChannels = (serverId: string) =>
  (s: { channels: Record<string, Channel[]> }) => s.channels[serverId] ?? EMPTY_CHANNELS;

/** Selector: members for a specific server */
export const selectServerMembers = (serverId: string) =>
  (s: { members: Record<string, Member[]> }) => s.members[serverId] ?? EMPTY_MEMBERS;

/** Selector: roles for a specific server */
export const selectServerRoles = (serverId: string) =>
  (s: { roles: Record<string, Role[]> }) => s.roles[serverId] ?? EMPTY_ROLES;

/** Selector: categories for a specific server */
export const selectServerCategories = (serverId: string) =>
  (s: { categories: Record<string, Category[]> }) => s.categories[serverId] ?? EMPTY_CATEGORIES;

/** Selector: current user's permissions for a server */
export const selectMyPermissions = (serverId: string) =>
  (s: { permissions: Record<string, number> }) => s.permissions[serverId] ?? 0;

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
      useServersStore.setState({
        members: { ...store.members, [server_id]: current.filter((m) => m.user_id !== user_id) },
      });
      break;
    }
    case 'MemberUpdate': {
      const { server_id, user_id, timeout_until, nickname, role_ids } = event.d;
      if (!server_id || !user_id) break;
      if (!store.servers.some((s) => s.id === server_id)) break;
      const current = store.members[server_id] ?? [];
      // H22: Process all member update fields
      const updates: Record<string, unknown> = {};
      if ('timeout_until' in event.d) updates.timeout_until = timeout_until;
      if ('nickname' in event.d) updates.nickname = nickname;
      if ('role_ids' in event.d) updates.role_ids = role_ids;
      const stateUpdate: Record<string, unknown> = {
        members: {
          ...store.members,
          [server_id]: current.map((m) =>
            m.user_id === user_id ? { ...m, ...updates } : m
          ),
        },
      };
      // Only invalidate permission caches when the CURRENT user's roles change
      if ('role_ids' in event.d) {
        const currentUserId = useAuthStore.getState().user?.id;
        if (user_id === currentUserId) {
          const { [server_id]: _p, ...restPerms } = store.permissions;
          const channelIds = (store.channels[server_id] ?? []).map((c) => c.id);
          const restChanPerms = { ...store.channelPermissions };
          for (const cid of channelIds) delete restChanPerms[cid];
          stateUpdate.permissions = restPerms;
          stateUpdate.channelPermissions = restChanPerms;
        }
      }
      useServersStore.setState(stateUpdate);
      break;
    }
    case 'ServerUpdate': {
      const { server } = event.d;
      if (!server?.id) break;
      useServersStore.setState({
        servers: store.servers.map((s) => (s.id === server.id ? server : s)),
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
