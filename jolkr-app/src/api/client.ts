import type {
  User, Server, Channel, Message, Member, Ban,
  DmChannel, Friendship, Invite, TokenPair, Attachment,
  PreKeyBundleResponse, Role, Category, ChannelOverwrite, Thread,
  ServerEmoji, NotificationSetting, AuditLogEntry, Webhook, Poll,
} from './types';
import { getApiBaseUrl } from '../platform/config';
import { storage } from '../platform/storage';

let apiBase = '/api';
let accessToken: string | null = null;
let refreshToken: string | null = null;
let isRefreshing = false;
let refreshQueue: Array<() => void> = [];
let lastRefreshAttempt = 0;
let loggedOut = false;

// Persistent logout flag — survives page refresh unlike in-memory flag
function setLogoutFlag() {
  loggedOut = true;
  try { localStorage.setItem('jolkr_logged_out', '1'); } catch { /* ignore */ }
}
function clearLogoutFlag() {
  loggedOut = false;
  try { localStorage.removeItem('jolkr_logged_out'); } catch { /* ignore */ }
}
function checkLogoutFlag(): boolean {
  try { return localStorage.getItem('jolkr_logged_out') === '1'; } catch { return false; }
}

/** Load tokens from secure storage on startup. Must be called before any API request. */
export async function initTokens() {
  apiBase = getApiBaseUrl();
  // If logout flag is set, refuse to load tokens — flag is only cleared by login/register
  if (checkLogoutFlag()) {
    accessToken = null;
    refreshToken = null;
    // Keep retrying cleanup in case Stronghold save didn't finish
    await storage.remove('access_token').catch(() => {});
    await storage.remove('refresh_token').catch(() => {});
    return;
  }
  accessToken = await storage.get('access_token');
  refreshToken = await storage.get('refresh_token');
}

let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let periodicRefreshInterval: ReturnType<typeof setInterval> | null = null;

/** Check if the access token is expired or within 5 minutes of expiry. */
function isAccessTokenExpiredOrNearExpiry(): boolean {
  if (!accessToken) return true;
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    const expiresAt = payload.exp * 1000;
    const margin = 5 * 60 * 1000; // 5 minutes
    return Date.now() > expiresAt - margin;
  } catch {
    return true;
  }
}

export async function setTokens(tokens: TokenPair) {
  if (loggedOut || checkLogoutFlag()) return; // Block token writes after logout
  // Set in-memory FIRST so even if storage fails, current session works
  accessToken = tokens.access_token;
  refreshToken = tokens.refresh_token;
  try {
    await storage.set('access_token', tokens.access_token);
    await storage.set('refresh_token', tokens.refresh_token);
  } catch (e) {
    console.warn('[setTokens] Storage write failed, retrying once:', e);
    try {
      await storage.set('access_token', tokens.access_token);
      await storage.set('refresh_token', tokens.refresh_token);
    } catch {
      console.error('[setTokens] Storage write failed on retry — tokens only in memory');
    }
  }
  scheduleProactiveRefresh(tokens.expires_in ?? 86400);
  startPeriodicRefresh();
}

function scheduleProactiveRefresh(expiresInSecs: number) {
  if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer);
  // Refresh 30 minutes before expiry (minimum 60s from now)
  const refreshInMs = Math.max(60_000, (expiresInSecs - 1800) * 1000);
  proactiveRefreshTimer = setTimeout(async () => {
    if (loggedOut || !refreshToken) return;
    await refreshAccessToken();
  }, refreshInMs);
}

/** Periodic backup: every 30 min check if token is near expiry (catches lost setTimeout). */
function startPeriodicRefresh() {
  if (periodicRefreshInterval) clearInterval(periodicRefreshInterval);
  periodicRefreshInterval = setInterval(async () => {
    if (loggedOut || !refreshToken) return;
    if (isAccessTokenExpiredOrNearExpiry()) {
      await refreshAccessToken();
    }
  }, 30 * 60 * 1000);
}

// Refresh token when app/tab becomes visible again (handles sleep/background).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && refreshToken && !loggedOut) {
      if (isAccessTokenExpiredOrNearExpiry()) {
        await refreshAccessToken();
      }
    }
  });
}

export async function clearTokens() {
  setLogoutFlag(); // Sync — survives page refresh
  if (proactiveRefreshTimer) { clearTimeout(proactiveRefreshTimer); proactiveRefreshTimer = null; }
  if (periodicRefreshInterval) { clearInterval(periodicRefreshInterval); periodicRefreshInterval = null; }
  accessToken = null;
  refreshToken = null;
  // Clear from secure storage (Stronghold on Tauri, localStorage on web)
  await storage.remove('access_token');
  await storage.remove('refresh_token');
}

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  return refreshToken;
}

/** Attempt to refresh the access token if we have a refresh token. */
export async function refreshAccessTokenIfNeeded(): Promise<boolean> {
  if (!refreshToken) return false;
  const now = Date.now();
  if (now - lastRefreshAttempt < 10_000) return !!accessToken;
  return refreshAccessToken();
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken || loggedOut) return false;
  // Retry up to 3 times with backoff to survive transient network issues
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${apiBase}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false; // Server rejected token — no point retrying
      const data = await res.json();
      const tokens = data.tokens ?? data;
      await setTokens(tokens);
      return true;
    } catch {
      // Network error — retry after backoff
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  return false;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  unwrapKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let res = await fetch(`${apiBase}${path}`, { ...options, headers });

  if (res.status === 401 && refreshToken && !loggedOut) {
    const now = Date.now();
    // Prevent infinite refresh loop: max 1 refresh per 10s
    if (now - lastRefreshAttempt < 10_000) {
      // H23: Drain refresh queue before redirect
      refreshQueue.forEach((cb) => cb());
      refreshQueue = [];
      await clearTokens();
      window.location.href = `${import.meta.env.BASE_URL}login`;
      throw new ApiError(401, 'Session expired');
    }

    if (!isRefreshing) {
      isRefreshing = true;
      lastRefreshAttempt = now;
      const ok = await refreshAccessToken();
      isRefreshing = false;
      if (ok) {
        refreshQueue.forEach((cb) => cb());
        refreshQueue = [];
        headers['Authorization'] = `Bearer ${accessToken}`;
        res = await fetch(`${apiBase}${path}`, { ...options, headers });
      } else {
        refreshQueue.forEach((cb) => cb());
        refreshQueue = [];
        await clearTokens();
        window.location.href = `${import.meta.env.BASE_URL}login`;
        throw new ApiError(401, 'Session expired');
      }
    } else {
      await new Promise<void>((resolve) => refreshQueue.push(resolve));
      if (!accessToken) throw new ApiError(401, 'Session expired');
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`${apiBase}${path}`, { ...options, headers });
    }
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Request failed' }));
    const msg = err?.error?.message || err?.message || (typeof err?.error === 'string' ? err.error : 'Request failed');
    throw new ApiError(res.status, msg);
  }

  // Handle responses with no body (e.g. 201 Created with empty body)
  const text = await res.text();
  if (!text) return undefined as T;

  const json = JSON.parse(text);
  if (unwrapKey && json[unwrapKey] !== undefined) {
    return json[unwrapKey] as T;
  }
  return json as T;
}

// Auth
export async function register(email: string, username: string, password: string): Promise<TokenPair> {
  clearLogoutFlag(); // Allow token writes for explicit register
  const data = await request<{ tokens: TokenPair }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, username, password }),
  });
  const tokens = data.tokens ?? (data as unknown as TokenPair);
  await setTokens(tokens);
  return tokens;
}

export async function login(email: string, password: string): Promise<TokenPair> {
  clearLogoutFlag(); // Allow token writes for explicit login
  const data = await request<{ tokens: TokenPair }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const tokens = data.tokens ?? (data as unknown as TokenPair);
  await setTokens(tokens);
  return tokens;
}

export async function resetPassword(email: string, newPassword: string, adminSecret: string): Promise<void> {
  await request<void>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, new_password: newPassword, admin_secret: adminSecret }),
  });
}

export async function forgotPassword(email: string): Promise<void> {
  await request<void>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPasswordConfirm(token: string, newPassword: string): Promise<void> {
  await request<void>('/auth/reset-password-confirm', {
    method: 'POST',
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request<void>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

// Users
export const getMe = () => request<User>('/users/@me', {}, 'user');
export const updateMe = (body: { username?: string; display_name?: string; bio?: string; avatar_url?: string; status?: string | null; show_read_receipts?: boolean }) =>
  request<User>('/users/@me', { method: 'PATCH', body: JSON.stringify(body) }, 'user');
export const getUser = (id: string) => request<User>(`/users/${id}`, {}, 'user');
export const getUsersBatch = async (ids: string[]): Promise<User[]> => {
  const results = await Promise.all(ids.map((id) => getUser(id).catch(() => null)));
  return results.filter((u): u is User => u !== null);
};
export const searchUsers = (q: string) => request<User[]>(`/users/search?q=${encodeURIComponent(q)}`, {}, 'users');

// Servers
export const getServers = () => request<Server[]>('/servers', {}, 'servers');
export const createServer = (body: { name: string; description?: string }) =>
  request<Server>('/servers', { method: 'POST', body: JSON.stringify(body) }, 'server');
export const getServer = (id: string) => request<Server>(`/servers/${id}`, {}, 'server');
export const updateServer = (id: string, body: { name?: string; description?: string; icon_url?: string; is_public?: boolean }) =>
  request<Server>(`/servers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, 'server');
export const deleteServer = (id: string) =>
  request<void>(`/servers/${id}`, { method: 'DELETE' });
export const getServerMembers = (serverId: string) =>
  request<Member[]>(`/servers/${serverId}/members`, {}, 'members');
export const leaveServer = (serverId: string) =>
  request<void>(`/servers/${serverId}/members/@me`, { method: 'DELETE' });

export const reorderServers = (serverIds: string[]) =>
  request<void>('/users/@me/servers/reorder', {
    method: 'PUT',
    body: JSON.stringify({ server_ids: serverIds }),
  });
export const discoverServers = (limit = 20, offset = 0) =>
  request<Server[]>(`/servers/discover?limit=${limit}&offset=${offset}`, {}, 'servers');

export const joinPublicServer = (serverId: string) =>
  request<void>(`/servers/${serverId}/join`, { method: 'POST' });

// Server Moderation
export const kickMember = (serverId: string, userId: string) =>
  request<void>(`/servers/${serverId}/members/${userId}`, { method: 'DELETE' });
export const banMember = (serverId: string, userId: string, reason?: string) =>
  request<Ban>(`/servers/${serverId}/bans`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, ...(reason ? { reason } : {}) }),
  }, 'ban');
export const unbanMember = (serverId: string, userId: string) =>
  request<void>(`/servers/${serverId}/bans/${userId}`, { method: 'DELETE' });
export const getBans = (serverId: string) =>
  request<Ban[]>(`/servers/${serverId}/bans`, {}, 'bans');
export const setNickname = (serverId: string, userId: string, nickname?: string) =>
  request<void>(`/servers/${serverId}/members/${userId}/nickname`, {
    method: 'PATCH',
    body: JSON.stringify({ nickname: nickname || null }),
  });

// Categories
export const getCategories = (serverId: string) =>
  request<Category[]>(`/servers/${serverId}/categories`, {}, 'categories');
export const createCategory = (serverId: string, body: { name: string }) =>
  request<Category>(`/servers/${serverId}/categories`, { method: 'POST', body: JSON.stringify(body) }, 'category');
export const updateCategory = (id: string, body: { name?: string; position?: number }) =>
  request<Category>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, 'category');
export const deleteCategory = (id: string) =>
  request<void>(`/categories/${id}`, { method: 'DELETE' });

// Roles
export const getRoles = (serverId: string) =>
  request<Role[]>(`/servers/${serverId}/roles`, {}, 'roles');
export const createRole = (serverId: string, body: { name: string; color?: number; permissions?: number }) =>
  request<Role>(`/servers/${serverId}/roles`, { method: 'POST', body: JSON.stringify(body) }, 'role');
export const updateRole = (id: string, body: { name?: string; color?: number; position?: number; permissions?: number }) =>
  request<Role>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, 'role');
export const deleteRole = (id: string) =>
  request<void>(`/roles/${id}`, { method: 'DELETE' });
export const assignRole = (serverId: string, roleId: string, userId: string) =>
  request<void>(`/servers/${serverId}/roles/${roleId}/members`, { method: 'PUT', body: JSON.stringify({ user_id: userId }) });
export const removeRole = (serverId: string, roleId: string, userId: string) =>
  request<void>(`/servers/${serverId}/roles/${roleId}/members/${userId}`, { method: 'DELETE' });
export const getMembersWithRoles = (serverId: string) =>
  request<Member[]>(`/servers/${serverId}/members-with-roles`, {}, 'members');
export const getMyPermissions = (serverId: string) =>
  request<{ permissions: number }>(`/servers/${serverId}/permissions/@me`);

// Channels
export const getChannels = (serverId: string) =>
  request<Channel[]>(`/servers/${serverId}/channels/list`, {}, 'channels');
export const createChannel = (serverId: string, body: { name: string; kind: string; topic?: string; category_id?: string }) =>
  request<Channel>(`/servers/${serverId}/channels`, { method: 'POST', body: JSON.stringify(body) }, 'channel');
export const getChannel = (id: string) => request<Channel>(`/channels/${id}`, {}, 'channel');
export const updateChannel = (id: string, body: { name?: string; topic?: string; category_id?: string; is_nsfw?: boolean; slowmode_seconds?: number }) =>
  request<Channel>(`/channels/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, 'channel');
export const reorderChannels = (serverId: string, positions: Array<{ id: string; position: number }>) =>
  request<Channel[]>(`/servers/${serverId}/channels/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ channel_positions: positions }),
  }, 'channels');
export const deleteChannel = (id: string) =>
  request<void>(`/channels/${id}`, { method: 'DELETE' });

// Channel Permission Overwrites
export const getMyChannelPermissions = (channelId: string) =>
  request<{ permissions: number }>(`/channels/${channelId}/permissions/@me`);

export const getChannelOverwrites = (channelId: string) =>
  request<ChannelOverwrite[]>(`/channels/${channelId}/overwrites`, {}, 'overwrites');

export const upsertChannelOverwrite = (channelId: string, body: {
  target_type: 'role' | 'member'; target_id: string; allow: number; deny: number;
}) => request<ChannelOverwrite>(`/channels/${channelId}/overwrites`, {
  method: 'PUT', body: JSON.stringify(body),
}, 'overwrite');

export const deleteChannelOverwrite = (channelId: string, targetType: string, targetId: string) =>
  request<void>(`/channels/${channelId}/overwrites/${targetType}/${targetId}`, { method: 'DELETE' });

// Messages
export const getMessages = (channelId: string, limit = 50, before?: string) => {
  let path = `/channels/${channelId}/messages?limit=${limit}`;
  if (before) path += `&before=${before}`;
  return request<Message[]>(path, {}, 'messages');
};
export const sendMessage = (channelId: string, content: string, nonce?: string, reply_to_id?: string) =>
  request<Message>(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, nonce, reply_to_id }),
  }, 'message');
export const editMessage = (messageId: string, content: string) =>
  request<Message>(`/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  }, 'message');
export const deleteMessage = (messageId: string) =>
  request<void>(`/messages/${messageId}`, { method: 'DELETE' });

// Search
export const searchMessages = (channelId: string, q: string, limit = 50) =>
  request<Message[]>(`/channels/${channelId}/messages/search?q=${encodeURIComponent(q)}&limit=${limit}`, {}, 'messages');

// Pins
export const pinMessage = (channelId: string, messageId: string) =>
  request<Message>(`/channels/${channelId}/pins/${messageId}`, { method: 'POST' }, 'message');
export const unpinMessage = (channelId: string, messageId: string) =>
  request<Message>(`/channels/${channelId}/pins/${messageId}`, { method: 'DELETE' }, 'message');
export const getPinnedMessages = (channelId: string) =>
  request<Message[]>(`/channels/${channelId}/pins`, {}, 'messages');

// Attachments
export const getMessageAttachments = (messageId: string) =>
  request<Attachment[]>(`/messages/${messageId}/attachments`, {}, 'attachments');
export const uploadAttachment = async (channelId: string, messageId: string, file: File): Promise<Attachment> => {
  const form = new FormData();
  form.append('file', file);
  return request<Attachment>(
    `/channels/${channelId}/messages/${messageId}/attachments`,
    { method: 'POST', body: form },
    'attachment',
  );
};

// DMs
export const getDms = () => request<DmChannel[]>('/dms', {}, 'channels');
export const openDm = (userId: string) =>
  request<DmChannel>('/dms', { method: 'POST', body: JSON.stringify({ user_id: userId }) }, 'channel');
export const getDmMessages = (dmId: string, limit = 50, before?: string) => {
  let path = `/dms/${dmId}/messages?limit=${limit}`;
  if (before) path += `&before=${before}`;
  return request<Message[]>(path, {}, 'messages');
};
export const sendDmMessage = (dmId: string, body: {
  content?: string | null;
  encrypted_content?: string;
  nonce?: string;
  reply_to_id?: string;
}) =>
  request<Message>(`/dms/${dmId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, 'message');
export const editDmMessage = (messageId: string, content: string) =>
  request<Message>(`/dms/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  }, 'message');
export const deleteDmMessage = (messageId: string) =>
  request<void>(`/dms/messages/${messageId}`, { method: 'DELETE' });

// DM Pins
export const pinDmMessage = (dmId: string, messageId: string) =>
  request<Message>(`/dms/${dmId}/pins/${messageId}`, { method: 'POST' }, 'message');
export const unpinDmMessage = (dmId: string, messageId: string) =>
  request<Message>(`/dms/${dmId}/pins/${messageId}`, { method: 'DELETE' }, 'message');
export const getDmPinnedMessages = (dmId: string) =>
  request<Message[]>(`/dms/${dmId}/pins`, {}, 'messages');

export const addDmReaction = (messageId: string, emoji: string) =>
  request<void>(`/dms/messages/${messageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
export const getDmReactionsRaw = (messageId: string) =>
  request<RawReaction[]>(`/dms/messages/${messageId}/reactions`, {}, 'reactions');
export async function getDmReactionsAggregated(messageId: string, currentUserId: string) {
  const raw = await getDmReactionsRaw(messageId);
  const byEmoji: Record<string, { count: number; me: boolean }> = {};
  for (const r of raw) {
    if (!byEmoji[r.emoji]) byEmoji[r.emoji] = { count: 0, me: false };
    byEmoji[r.emoji].count++;
    if (r.user_id === currentUserId) byEmoji[r.emoji].me = true;
  }
  return Object.entries(byEmoji).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    me: data.me,
  }));
}
export const removeDmReaction = (messageId: string, emoji: string) =>
  request<void>(`/dms/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' });
export const createGroupDm = (userIds: string[], name?: string) =>
  request<DmChannel>('/dms', {
    method: 'POST',
    body: JSON.stringify({ user_ids: userIds, ...(name ? { name } : {}) }),
  }, 'channel');

export const addDmMember = (dmId: string, userId: string) =>
  request<DmChannel>(`/dms/${dmId}/members`, {
    method: 'PUT',
    body: JSON.stringify({ user_id: userId }),
  }, 'channel');

export const leaveDm = (dmId: string) =>
  request<void>(`/dms/${dmId}/members/@me`, { method: 'DELETE' });

export const closeDm = (dmId: string) =>
  request<void>(`/dms/${dmId}/close`, { method: 'POST' });

export const updateDm = (dmId: string, body: { name?: string }) =>
  request<DmChannel>(`/dms/${dmId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, 'channel');

// DM Read Receipts
export const markDmRead = (dmId: string, messageId: string) =>
  request<void>(`/dms/${dmId}/read`, {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId }),
  });

// DM Voice Call Signaling
export const initiateCall = (dmId: string) =>
  request<void>(`/dms/${dmId}/call`, { method: 'POST' });
export const acceptCall = (dmId: string) =>
  request<void>(`/dms/${dmId}/call/accept`, { method: 'POST' });
export const rejectCall = (dmId: string) =>
  request<void>(`/dms/${dmId}/call/reject`, { method: 'POST' });
export const endCall = (dmId: string) =>
  request<void>(`/dms/${dmId}/call/end`, { method: 'POST' });

export const uploadDmAttachment = async (dmId: string, messageId: string, file: File): Promise<Attachment> => {
  const form = new FormData();
  form.append('file', file);
  return request<Attachment>(
    `/dms/${dmId}/messages/${messageId}/attachments`,
    { method: 'POST', body: form },
    'attachment',
  );
};

// Reactions
export const addReaction = (messageId: string, emoji: string) =>
  request<void>(`/messages/${messageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });

interface RawReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export const getReactionsRaw = (messageId: string) =>
  request<RawReaction[]>(`/messages/${messageId}/reactions`, {}, 'reactions');

/** Fetch reactions for a message and aggregate them into {emoji, count, me} format */
export async function getReactionsAggregated(messageId: string, currentUserId: string) {
  const raw = await getReactionsRaw(messageId);
  const byEmoji: Record<string, { count: number; me: boolean }> = {};
  for (const r of raw) {
    if (!byEmoji[r.emoji]) byEmoji[r.emoji] = { count: 0, me: false };
    byEmoji[r.emoji].count++;
    if (r.user_id === currentUserId) byEmoji[r.emoji].me = true;
  }
  return Object.entries(byEmoji).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    me: data.me,
  }));
}

export const removeReaction = (messageId: string, emoji: string) =>
  request<void>(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' });

// Invites
export const createInvite = (serverId: string, body?: { max_uses?: number; max_age_seconds?: number }) =>
  request<Invite>(`/servers/${serverId}/invites`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  }, 'invite');
export const getInvites = (serverId: string) =>
  request<Invite[]>(`/servers/${serverId}/invites`, {}, 'invites');
export const deleteInvite = (serverId: string, inviteId: string) =>
  request<void>(`/servers/${serverId}/invites/${inviteId}`, { method: 'DELETE' });
export const useInvite = (code: string) =>
  request<Invite>(`/invites/${code}`, { method: 'POST' }, 'invite');

// Friends
export const getFriends = () => request<Friendship[]>('/friends', {}, 'friendships');
export const getPendingFriends = () => request<Friendship[]>('/friends/pending', {}, 'friendships');
export const sendFriendRequest = (userId: string) =>
  request<Friendship>('/friends', { method: 'POST', body: JSON.stringify({ user_id: userId }) }, 'friendship');
export const acceptFriend = (id: string) =>
  request<Friendship>(`/friends/${id}/accept`, { method: 'POST' }, 'friendship');
export const declineFriend = (id: string) =>
  request<void>(`/friends/${id}`, { method: 'DELETE' });
export const blockUser = (userId: string) =>
  request<Friendship>('/friends/block', { method: 'POST', body: JSON.stringify({ user_id: userId }) }, 'friendship');

// General file upload (avatars, server icons, etc.)
// When purpose is 'avatar' or 'icon', the backend converts to WebP and resizes.
export const uploadFile = async (file: File, purpose?: 'avatar' | 'icon'): Promise<{ key: string; url: string }> => {
  const form = new FormData();
  form.append('file', file);
  const query = purpose ? `?purpose=${purpose}` : '';
  return request<{ key: string; url: string }>(`/upload${query}`, { method: 'POST', body: form });
};

// Push / Devices
export const getVapidKey = () =>
  request<{ public_key: string }>('/push/vapid-key');

export const registerDevice = (body: {
  device_id?: string;
  device_name: string;
  device_type: string;
  push_token?: string;
}) => request<{ device: { id: string } }>('/devices', { method: 'POST', body: JSON.stringify(body) });

export const getDevices = () =>
  request<{ devices: Array<{ id: string; device_name: string; device_type: string; has_push_token: boolean; last_active_at: string | null; created_at: string }> }>('/devices');

export const deleteDevice = (deviceId: string) =>
  request<void>(`/devices/${deviceId}`, { method: 'DELETE' });

export const updatePushToken = (deviceId: string, push_token: string) =>
  request<void>(`/devices/${deviceId}/push-token`, { method: 'PATCH', body: JSON.stringify({ push_token }) });

// E2EE Keys
export const uploadPrekeys = (body: {
  device_id: string;
  identity_key: string;
  signed_prekey: string;
  signed_prekey_signature: string;
  one_time_prekeys: string[];
  pq_signed_prekey?: string;
  pq_signed_prekey_signature?: string;
}) => request<{ message: string; prekey_count: number }>('/keys/upload', {
  method: 'POST',
  body: JSON.stringify(body),
});

export const getPreKeyBundle = (userId: string) =>
  request<PreKeyBundleResponse>(`/keys/${userId}`);

// Channel E2EE
export const distributeChannelKeys = (channelId: string, body: {
  key_generation: number;
  recipients: Array<{ user_id: string; encrypted_key: string; nonce: string }>;
}, isDm?: boolean) => request<{ ok: boolean }>(isDm ? `/dms/${channelId}/e2ee/distribute` : `/channels/${channelId}/e2ee/distribute`, {
  method: 'POST',
  body: JSON.stringify(body),
});

export const getMyChannelKey = (channelId: string, isDm?: boolean) =>
  request<{
    encrypted_key: string;
    nonce: string;
    key_generation: number;
    distributor_user_id: string;
  } | null>(isDm ? `/dms/${channelId}/e2ee/my-key` : `/channels/${channelId}/e2ee/my-key`);

export const getChannelKeyGeneration = (channelId: string) =>
  request<{ key_generation: number }>(`/channels/${channelId}/e2ee/generation`);

// Threads
export const createThread = (channelId: string, messageId: string, name?: string) =>
  request<{ thread: Thread; message: Message }>(`/channels/${channelId}/threads`, {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId, ...(name ? { name } : {}) }),
  });

export const getThreads = (channelId: string, includeArchived = false) =>
  request<Thread[]>(`/channels/${channelId}/threads?include_archived=${includeArchived}`, {}, 'threads');

export const getThread = (threadId: string) =>
  request<Thread>(`/threads/${threadId}`, {}, 'thread');

export const updateThread = (threadId: string, body: { name?: string; is_archived?: boolean }) =>
  request<Thread>(`/threads/${threadId}`, { method: 'PATCH', body: JSON.stringify(body) }, 'thread');

export const getThreadMessages = (threadId: string, limit = 50, before?: string) => {
  let path = `/threads/${threadId}/messages?limit=${limit}`;
  if (before) path += `&before=${before}`;
  return request<Message[]>(path, {}, 'messages');
};

export const sendThreadMessage = (threadId: string, content: string, replyToId?: string) =>
  request<Message>(`/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, reply_to_id: replyToId }),
  }, 'message');

// ── Server Emojis ──────────────────────────────────────────────────────

export const getServerEmojis = (serverId: string) =>
  request<ServerEmoji[]>(`/servers/${serverId}/emojis`, {}, 'emojis');

export const uploadEmoji = async (serverId: string, name: string, file: File): Promise<ServerEmoji> => {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('file', file);
  return request<ServerEmoji>(`/servers/${serverId}/emojis`, {
    method: 'POST',
    body: formData,
  }, 'emoji');
};

export const deleteEmoji = (emojiId: string) =>
  request<void>(`/emojis/${emojiId}`, { method: 'DELETE' });

// ── Notification Settings ──────────────────────────────────────────────

export const getNotificationSettings = () =>
  request<NotificationSetting[]>('/users/me/notifications', {}, 'settings');

export const getNotificationSetting = (targetType: string, targetId: string) =>
  request<NotificationSetting>(`/users/me/notifications/${targetType}/${targetId}`);

export const updateNotificationSetting = (targetType: string, targetId: string, body: {
  muted: boolean;
  mute_until?: string | null;
  suppress_everyone?: boolean;
}) =>
  request<NotificationSetting>(`/users/me/notifications/${targetType}/${targetId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

// ── Audit Log ──────────────────────────────────────────────────────────

export const getAuditLog = (serverId: string, params?: { action?: string; limit?: number; before?: string }) => {
  const query = new URLSearchParams();
  if (params?.action) query.set('action', params.action);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.before) query.set('before', params.before);
  const qs = query.toString();
  return request<AuditLogEntry[]>(`/servers/${serverId}/audit-log${qs ? `?${qs}` : ''}`, {}, 'entries');
};

// Presence
export const queryPresence = async (userIds: string[]): Promise<Record<string, string>> => {
  const entries = await request<Array<{ user_id: string; status: string }>>('/presence/query', {
    method: 'POST',
    body: JSON.stringify({ user_ids: userIds }),
  }, 'presences');
  const result: Record<string, string> = {};
  if (Array.isArray(entries)) {
    entries.forEach((e) => { result[e.user_id] = e.status; });
  }
  return result;
};

// ── Member Timeouts ──────────────────────────────────────────────────

export const timeoutMember = (serverId: string, userId: string, timeoutUntil: string) =>
  request<void>(`/servers/${serverId}/members/${userId}/timeout`, {
    method: 'POST',
    body: JSON.stringify({ timeout_until: timeoutUntil }),
  });

export const removeTimeout = (serverId: string, userId: string) =>
  request<void>(`/servers/${serverId}/members/${userId}/timeout`, { method: 'DELETE' });

// ── Advanced Search ──────────────────────────────────────────────────

export const searchMessagesAdvanced = (channelId: string, params: {
  q?: string; from?: string; has?: string; before?: string; after?: string; limit?: number;
}) => {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.from) query.set('from', params.from);
  if (params.has) query.set('has', params.has);
  if (params.before) query.set('before', params.before);
  if (params.after) query.set('after', params.after);
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return request<Message[]>(`/channels/${channelId}/messages/search${qs ? `?${qs}` : ''}`, {}, 'messages');
};

// ── Webhooks ─────────────────────────────────────────────────────────

export const getChannelWebhooks = (channelId: string) =>
  request<Webhook[]>(`/channels/${channelId}/webhooks`, {}, 'webhooks');

export const createWebhook = (channelId: string, body: { name: string; avatar_url?: string }) =>
  request<Webhook>(`/channels/${channelId}/webhooks`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, 'webhook');

export const updateWebhook = (webhookId: string, body: { name?: string; avatar_url?: string }) =>
  request<Webhook>(`/webhooks/${webhookId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, 'webhook');

export const deleteWebhook = (webhookId: string) =>
  request<void>(`/webhooks/${webhookId}`, { method: 'DELETE' });

export const regenerateWebhookToken = (webhookId: string) =>
  request<Webhook>(`/webhooks/${webhookId}/token`, { method: 'POST' }, 'webhook');

// ── Polls ────────────────────────────────────────────────────────────

export const createPoll = (channelId: string, body: {
  question: string;
  options: string[];
  multi_select?: boolean;
  anonymous?: boolean;
  expires_at?: string;
}) =>
  request<{ poll: Poll; message: Message }>(`/channels/${channelId}/polls`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const votePoll = (pollId: string, optionId: string) =>
  request<Poll>(`/polls/${pollId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ option_id: optionId }),
  }, 'poll');

export const unvotePoll = (pollId: string, optionId: string) =>
  request<Poll>(`/polls/${pollId}/vote`, {
    method: 'DELETE',
    body: JSON.stringify({ option_id: optionId }),
  }, 'poll');

export const getPoll = (pollId: string) =>
  request<Poll>(`/polls/${pollId}`, {}, 'poll');
