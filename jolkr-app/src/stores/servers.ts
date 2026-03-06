import { create } from 'zustand';
import type { Server, Channel, Member, Role, Category, ServerEmoji } from '../api/types';
import * as api from '../api/client';
import { wsClient } from '../api/ws';

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
  createChannel: (serverId: string, name: string, kind: string, topic?: string, categoryId?: string) => Promise<Channel>;
  updateServer: (id: string, body: { name?: string; description?: string; icon_url?: string }) => Promise<Server>;
  updateChannel: (id: string, serverId: string, body: { name?: string; topic?: string; category_id?: string; is_nsfw?: boolean; slowmode_seconds?: number }) => Promise<Channel>;
  deleteServer: (id: string) => Promise<void>;
  deleteChannel: (id: string, serverId: string) => Promise<void>;
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
    set({ loading: true });
    try {
      const servers = await api.getServers();
      set({ servers, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchChannels: async (serverId) => {
    // Skip if already cached — WS events keep this updated
    if (get().channels[serverId]?.length) return;
    try {
      const channels = await api.getChannels(serverId);
      set({ channels: { ...get().channels, [serverId]: channels } });
    } catch (e) {
      console.warn('Failed to fetch channels:', e);
    }
  },

  fetchMembers: async (serverId) => {
    // Skip if already cached — WS events keep this updated
    if (get().members[serverId]?.length) return;
    try {
      const members = await api.getServerMembers(serverId);
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

  leaveServer: async (id) => {
    await api.leaveServer(id);
    // Clean up all state for this server
    const channelIds = (get().channels[id] ?? []).map((c) => c.id);
    const { [id]: _ch, ...restChannels } = get().channels;
    const { [id]: _mem, ...restMembers } = get().members;
    const { [id]: _cat, ...restCategories } = get().categories;
    const { [id]: _rol, ...restRoles } = get().roles;
    const { [id]: _perm, ...restPermissions } = get().permissions;
    // Remove channel permissions for this server's channels
    const chPerms = { ...get().channelPermissions };
    for (const cid of channelIds) delete chPerms[cid];
    set({
      servers: get().servers.filter((s) => s.id !== id),
      channels: restChannels,
      members: restMembers,
      categories: restCategories,
      roles: restRoles,
      permissions: restPermissions,
      channelPermissions: chPerms,
    });
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

// Wire up WebSocket events for server-level changes
wsClient.on((op, d) => {
  const store = useServersStore.getState();
  switch (op) {
    case 'ChannelCreate': {
      const channel = d.channel as Channel;
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
      const channel = d.channel as Channel;
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
      const channelId = d.channel_id as string;
      const serverId = d.server_id as string;
      if (!channelId || !serverId) break;
      if (!store.servers.some((s) => s.id === serverId)) break;
      const current = store.channels[serverId] ?? [];
      useServersStore.setState({
        channels: { ...store.channels, [serverId]: current.filter((c) => c.id !== channelId) },
      });
      break;
    }
    case 'MemberJoin': {
      const serverId = d.server_id as string;
      if (!serverId) break;
      if (!store.servers.some((s) => s.id === serverId)) break;
      store.fetchMembers(serverId).catch(() => {});
      break;
    }
    case 'MemberLeave': {
      const serverId = d.server_id as string;
      const userId = d.user_id as string;
      if (!serverId || !userId) break;
      if (!store.servers.some((s) => s.id === serverId)) break;
      const current = store.members[serverId] ?? [];
      useServersStore.setState({
        members: { ...store.members, [serverId]: current.filter((m) => m.user_id !== userId) },
      });
      break;
    }
    case 'MemberUpdate': {
      const serverId = d.server_id as string;
      const userId = d.user_id as string;
      if (!serverId || !userId) break;
      if (!store.servers.some((s) => s.id === serverId)) break;
      const current = store.members[serverId] ?? [];
      // H22: Process all member update fields
      const updates: Record<string, unknown> = {};
      if ('timeout_until' in d) updates.timeout_until = d.timeout_until as string | null;
      if ('nickname' in d) updates.nickname = d.nickname as string | null;
      if ('role_ids' in d) updates.role_ids = d.role_ids as string[];
      const stateUpdate: Record<string, unknown> = {
        members: {
          ...store.members,
          [serverId]: current.map((m) =>
            m.user_id === userId ? { ...m, ...updates } : m
          ),
        },
      };
      // Invalidate permission caches when roles change so UI recomputes permissions
      if ('role_ids' in d) {
        const { [serverId]: _p, ...restPerms } = store.permissions;
        const { [serverId]: _cp, ...restChanPerms } = store.channelPermissions;
        stateUpdate.permissions = restPerms;
        stateUpdate.channelPermissions = restChanPerms;
      }
      useServersStore.setState(stateUpdate);
      break;
    }
    case 'ServerUpdate': {
      const server = d.server as Server;
      if (!server?.id) break;
      useServersStore.setState({
        servers: store.servers.map((s) => (s.id === server.id ? server : s)),
      });
      break;
    }
    case 'ServerDelete': {
      const serverId = d.server_id as string;
      if (!serverId) break;
      // Remove server and all related state
      const channelIds = (store.channels[serverId] ?? []).map((c) => c.id);
      const { [serverId]: _ch, ...restChannels } = store.channels;
      const { [serverId]: _mem, ...restMembers } = store.members;
      const { [serverId]: _cat, ...restCategories } = store.categories;
      const { [serverId]: _rol, ...restRoles } = store.roles;
      const { [serverId]: _perm, ...restPermissions } = store.permissions;
      const chPerms = { ...store.channelPermissions };
      for (const cid of channelIds) delete chPerms[cid];
      useServersStore.setState({
        servers: store.servers.filter((s) => s.id !== serverId),
        channels: restChannels,
        members: restMembers,
        categories: restCategories,
        roles: restRoles,
        permissions: restPermissions,
        channelPermissions: chPerms,
      });
      break;
    }
  }
});
