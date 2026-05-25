# Frontend ↔ Backend Integration Reference

> **Version**: 0.11.3 (matches `jolkr-app/package.json` and the `jolkr-server` workspace).
>
> Complete map of every wire between `jolkr-app` (React 19 + Vite + TypeScript + Zustand, wrapped in Tauri) and `jolkr-server` (Rust / Axum). Reading this end-to-end is enough to bring a new client implementation 1:1 on the same backend without missing a single endpoint, event, or invariant.
>
> The companion document `docs-backend-api-reference.md` is the authoritative endpoint/event reference; this file is the integration playbook: which files call what, in which order, with which state container.

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [Platform & URL configuration](#2-platform--url-configuration)
3. [Token & auth lifecycle](#3-token--auth-lifecycle)
4. [REST API client (`src/api/client.ts`)](#4-rest-api-client-srcapiclientts)
5. [WebSocket gateway client (`src/api/ws.ts`)](#5-websocket-gateway-client-srcapiwsts)
6. [Voice WebSocket & WebRTC](#6-voice-websocket--webrtc)
7. [E2EE crypto stack](#7-e2ee-crypto-stack)
8. [Zustand stores](#8-zustand-stores)
9. [Services layer](#9-services-layer)
10. [Hooks that touch the network](#10-hooks-that-touch-the-network)
11. [App boot order & routing](#11-app-boot-order--routing)
12. [Wire types (TypeScript)](#12-wire-types-typescript)
13. [Build, env & platform detection](#13-build-env--platform-detection)
14. [Cloudflare upload bypass](#14-cloudflare-upload-bypass)
15. [Migration checklist (porting to a new client)](#15-migration-checklist-porting-to-a-new-client)

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (jolkr-app)                                       │
│                                                             │
│  src/api/client.ts  ── fetch() ──▶ /api/*       (REST)      │
│  src/api/ws.ts      ── WebSocket ▶ /ws          (gateway)   │
│  src/voice/         ── WebSocket ▶ /media/ws/voice          │
│                     ── WebRTC ───▶ STUN + UDP media         │
│                                                             │
│  State:   Zustand stores (module-level singletons)          │
│  Crypto:  @noble/curves (Ed/X25519) + @noble/post-quantum   │
│           (ML-KEM-768) — derived in memory, seed on disk    │
│  Network: native fetch + WebSocket; no axios / no React     │
│           Query / no Redux                                  │
└─────────────────────────────────────────────────────────────┘
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────┐  ┌────────────────┐  ┌────────────────┐
│ Axum API     │  │ WS Gateway     │  │ jolkr-media    │
│ /api/*       │  │ /ws            │  │ /ws/voice +    │
│ HTTP JSON    │  │ JSON frames    │  │ UDP SFU        │
└──────────────┘  └────────────────┘  └────────────────┘
```

### Key files

| File | Role |
|------|------|
| `src/api/client.ts` | Every REST call, token store, refresh logic, upload helpers |
| `src/api/ws.ts` | Gateway singleton (`wsClient`) — connect, heartbeat, fan-out |
| `src/api/ws-events.ts` | Discriminated union of every server→client event type |
| `src/api/types.ts` | TS types (mostly `ts-rs`-generated, with a few FE-side overlays) |
| `src/api/generated/*.ts` | Generated from Rust DTOs via `ts-rs` |
| `src/platform/config.ts` | URL resolution (web vs Tauri vs Tauri-dev) |
| `src/platform/detect.ts` | `isTauri`, `isMobile`, `isDesktop`, `isWeb` |
| `src/platform/storage.ts` | Stronghold (desktop Tauri) vs `localStorage` (web + mobile Tauri) |
| `src/voice/voiceClient.ts` | Voice signalling WebSocket |
| `src/voice/voiceService.ts` | WebRTC orchestration (peer connections, transceivers) |
| `src/voice/encryptionWorker.ts` | Voice E2EE worker (SFrame-style) |
| `src/crypto/keys.ts` | X25519 / Ed25519 / ML-KEM-768 primitives |
| `src/crypto/e2ee.ts` | Per-DM session encryption (X3DH-derived) |
| `src/crypto/channelKeys.ts` | Channel sender-key cache |
| `src/services/e2ee.ts` | Init / reset orchestrator |
| `src/services/pushRegistration.ts` | Web Push registration + VAPID |
| `src/stores/*` | Zustand stores — see §8 |
| `src/App.tsx` | Boot sequence, routing, guards, deep-link handling |

### Tech versions (`package.json`)

- React 19.2, react-router-dom 7.13, Zustand 5.0
- Vite 7.3, TypeScript 5.9
- `@noble/curves` 2.0, `@noble/post-quantum` 0.5
- Tauri 2.10 with plugins: `stronghold`, `deep-link`, `autostart`, `process`, `updater`
- DnD: `@dnd-kit/core` 6.3 + `sortable` 10 + `modifiers` 9
- Optional embedded players: `nomercy-music-player`, `nomercy-video-player`

---

## 2. Platform & URL configuration

Source: `src/platform/config.ts` + `src/platform/detect.ts`.

| Function | Web (prod) | Web (Vite dev, `VITE_API_TARGET=local`) | Web (Vite dev, default) | Tauri desktop | Tauri mobile |
|----------|------------|----------------------------------------|-------------------------|---------------|--------------|
| `getServerUrl()` | `""` (same origin) | `""` | `""` | `https://jolkr.app` | `https://jolkr.app` |
| `getApiBaseUrl()` | `/api` | `/api` (via Vite proxy) | `https://jolkr.app/api` | `https://jolkr.app/api` | `https://jolkr.app/api` |
| `getUploadBaseUrl()` | `https://upload.jolkr.app/api` | `/api` (local nginx) | `https://upload.jolkr.app/api` | `https://upload.jolkr.app/api` | `https://upload.jolkr.app/api` |
| `getWsUrl()` | `wss://{host}/ws` (auto) | `ws://{host}/ws` | `wss://jolkr.app/ws` | `wss://jolkr.app/ws` | `wss://jolkr.app/ws` |
| `getMediaWsUrl()` | `wss://{host}/media/ws/voice` | `ws://{host}/media/ws/voice` | `wss://jolkr.app/media/ws/voice` | `wss://jolkr.app/media/ws/voice` | same |
| `getBasename()` | `/app` | `/app` | `/app` | `/` | `/` |
| `rewriteStorageUrl(url)` | `minio:9000` → `/s3/` | passthrough | `minio:9000` → `https://jolkr.app/s3/` | `minio:9000` → `{server}/s3/` | same |
| `buildInviteUrl(code)` | `{origin}/app/invite/{code}` | same | same | `https://jolkr.app/app/invite/{code}` | same |

### Why the upload base differs

Cloudflare imposes a 100 MB request-body limit on the Free/Pro plans, which is below the backend's `MAX_FILE_SIZE = 250 MB`. The `upload.jolkr.app` subdomain is a DNS-only A-record (not Cloudflare-proxied) wired into the same nginx; the remote nginx restricts that host to only the two message-attachment endpoints. `getUploadBaseUrl()` returns it for the message-attachment flows only — every other call still goes through the normal Cloudflare-proxied path. (Details in §14 and §26.3 of the backend reference.)

### Vite dev proxy (`vite.config.ts`)

```
/api  → http://localhost:8080
/ws   → ws://localhost:8080
```

### Build-time defines

- `__APP_VERSION__` (from `package.json`)
- `import.meta.env.BASE_URL` — `/app/` for web, `/` for Tauri
- `import.meta.env.VITE_API_TARGET` — set to `local` to force the local-backend dev path
- `import.meta.env.TAURI_ENV_PLATFORM` — set automatically by Tauri build (`android | ios | windows | macos | linux`)

---

## 3. Token & auth lifecycle

Source: `src/api/client.ts` + `src/platform/storage.ts` + `src/stores/auth.ts`.

### Token storage

| Platform | Implementation | Notes |
|----------|----------------|-------|
| Tauri desktop | `@tauri-apps/plugin-stronghold` encrypted vault at `{appDataDir}/vault.hold` | Vault password is a per-install random 32-byte hex string stored in `sessionStorage` under `STORAGE_KEYS.VAULT_PASSWORD`. Legacy installs may still use the hard-coded `"io.jolkr.app"` password — `Stronghold.load` falls back to it when the new password fails. SEC-011 (server-side migration 040 + client release) rotates this on first install. |
| Tauri mobile (Android/iOS) | `localStorage` | Stronghold hangs on Android — detection via UA. |
| Web | `localStorage` | Keys: `access_token`, `refresh_token`. |

Persistent localStorage flags (across platforms):

- `jolkr_logged_out` — survives page reload; blocks `setTokens` and `initTokens` until cleared by explicit login/register
- `jolkr_e2ee_device_id` — random UUID identifying this installation for E2EE prekey upload
- `jolkr_e2ee_seed_v2` — encrypted seed for in-memory E2EE key derivation (web) / Stronghold (desktop)

### `TokenPair`

```typescript
interface TokenPair {
  access_token: string;   // HS256 JWT
  refresh_token: string;  // opaque, bcrypt-hashed on the server
  expires_in: number;     // seconds, used to schedule proactive refresh
}
```

### Authorization header

`request<T>()` always attaches `Authorization: Bearer <accessToken>` if a token is in memory, and `Content-Type: application/json` for non-FormData bodies. Multipart uploads omit the JSON content-type so the browser can set the multipart boundary.

### JWT decode (client-side only)

`isAccessTokenExpiredOrNearExpiry()` base64-decodes the middle JWT segment **without verifying the signature**, reads `payload.exp`, and treats the token as expired if `Date.now() > exp*1000 - 5min`. The server, of course, still verifies signatures.

### Refresh triggers

Four independent triggers can call `refreshAccessToken()`:

1. **Proactive timer** — scheduled in `setTokens()` for `max(60s, (expires_in − 1800) * 1000)`.
2. **Periodic interval** — every 30 minutes, re-checks `isAccessTokenExpiredOrNearExpiry()`.
3. **Visibility change** — `document.visibilitychange` → if the tab returns to foreground and the token is near expiry, refresh.
4. **HTTP 401 response** — `request<T>()` queues callers, refreshes once, retries the original request.

Deduplication: `lastRefreshAttempt` enforces ≥ 10 s between attempts. While a refresh is in flight, subsequent 401-handlers push onto `refreshQueue` and wait for the same promise. On refresh failure, the queue is drained and the user is sent to `/login`.

The refresh call retries up to 3 times with linear backoff (1 s, 2 s, 3 s) for transient network errors.

### Login flow

```
1. POST /api/auth/login { email, password }     → AuthResponse { user, tokens }
2. setTokens(tokens)                            → store + schedule refresh
3. authStore.user = response.user               → already in the response
4. wsClient.connect()                           → gateway authenticates with Identify
5. registerPush() (if logged in + permission)   → /api/devices + /api/push/vapid-key
6. initE2EE(deviceId)                           → load/generate keys, upload prekeys if needed
```

Register is identical with `POST /api/auth/register`.

### Logout flow

```
1. voiceStore.leaveChannel() / endCall()
2. wsClient.disconnect()
3. stopUnreadBadge() / stopNotifications()
4. api.clearTokens()              → setLogoutFlag(), clear in-memory, wipe Stronghold/localStorage
5. resetE2EE()                    → drop in-memory keys + clear seed from storage
6. resetAllStores()               → every Zustand store calls its reset action
7. user = null; navigate('/login')
```

The persistent `jolkr_logged_out` flag is cleared only by an explicit `login()` or `register()` call.

### `useAuthStore`

```typescript
type AuthState = {
  user: MeProfile | null;
  isLoading: boolean;
  loadUser(): Promise<void>;
  setUser(u: MeProfile | null): void;
  logout(): Promise<void>;
};
```

`loadUser()` is called once on boot from `AppInit` after `initTokens()`. It calls `getMe()`; on 401 the token-refresh layer kicks in or the user is redirected. The store has `isLoading: true` until the first attempt resolves so the route guards can avoid flashing the login page.

---

## 4. REST API client (`src/api/client.ts`)

Every method lives at module scope and is imported as either a named export (`api.login(...)`) or via the wildcard `import * as api`. Below is the complete surface, grouped by domain. All paths are relative to `getApiBaseUrl()`. Upload endpoints use `getUploadBaseUrl()` automatically.

> Convention: a third positional argument to `request<T>()` is the response-envelope key to unwrap. E.g. `request<Server>('/servers/:id', {}, 'server')` returns `body.server` directly.

### 4.1 Auth (`src/api/client.ts`)

| Function | Method | Path | Body / Response |
|----------|--------|------|-----------------|
| `register(email, username, password)` | POST | `/auth/register` | `AuthResponse { user, tokens }` |
| `login(email, password)` | POST | `/auth/login` | `AuthResponse` |
| `forgotPassword(email)` | POST | `/auth/forgot-password` | 204 always |
| `resetPasswordConfirm(token, newPassword)` | POST | `/auth/reset-password-confirm` | 204 |
| `verifyEmail(token)` | POST | `/auth/verify-email` | 204 |
| `resendVerification()` | POST | `/auth/resend-verification` | 204 |
| `changePassword(current, new)` | POST | `/auth/change-password` | 204 |
| `refreshAccessToken()` (internal) | POST | `/auth/refresh` | `{ tokens }` |
| `refreshAccessTokenIfNeeded()` | — | — | Calls refresh if a refresh token exists and last attempt was > 10 s ago |

Also exported: `initTokens`, `setTokens`, `clearTokens`, `getAccessToken`, `getRefreshToken`, `ApiError`, `authedFetch(path, init?)` (streams raw `Response` while still attaching the bearer header).

### 4.2 Users

| Function | Method | Path |
|----------|--------|------|
| `getMe()` | GET | `/users/@me` |
| `updateMe(body)` | PATCH | `/users/@me` |
| `getUser(id)` | GET | `/users/:id` |
| `getUsersBatch(ids)` | POST | `/users/batch` — chunks `ids` in slices of 100 |
| `searchUsers(q)` | GET | `/users/search?q=…` |

### 4.3 Servers

`getServers`, `createServer`, `getServer`, `updateServer`, `deleteServer`, `getServerMembers`, `leaveServer`, `reorderServers`, `discoverServers(limit, offset)`, `joinPublicServer`, plus moderation: `kickMember`, `banMember`, `unbanMember`, `getBans`. `updateServer` body includes the typed `theme?: ServerThemeData | null` overlay (BE stores it as JSONB).

### 4.4 Members & moderation

`getMembersWithRoles(serverId)`, `getChannelMembers(channelId)` (members who can `VIEW_CHANNELS` after overwrites), `getMyPermissions(serverId)`, `timeoutMember(serverId, userId, until)`, `removeTimeout(serverId, userId)`, `markServerRead(serverId)`. `setNickname` (in roles section below) — wait, that's already in moderation.

### 4.5 Categories

`getCategories`, `createCategory`, `updateCategory`, `reorderCategories(serverId, positions[])`, `deleteCategory`.

### 4.6 Roles

`getRoles`, `createRole`, `updateRole`, `deleteRole`, `assignRole(serverId, roleId, userId)`, `removeRole(serverId, roleId, userId)`.

### 4.7 Channels

`getChannels`, `createChannel`, `updateChannel`, `deleteChannel`, `moveChannels(serverId, items[])` (the unified reorder+reparent endpoint at `PUT /servers/:id/channels/move`), plus permission overwrites: `getMyChannelPermissions`, `getChannelOverwrites`, `upsertChannelOverwrite`, `deleteChannelOverwrite`.

`updateChannel` accepts an `is_system?: boolean` field on the **frontend** signature for forward-compat — the backend currently ignores it (Archive Channel UI is a no-op). See `todos.md`.

### 4.8 Messages

`getMessages(channelId, limit?, before?)`, `sendMessage(channelId, content, nonce?, replyToId?)`, `editMessage(messageId, content, nonce?)`, `deleteMessage`, `searchMessagesAdvanced(channelId, { q, from, has, before, after, limit })`. Encrypted messages pass `nonce`; plaintext omits it.

### 4.9 Threads

`createThread(channelId, messageId, name?)` → `{ thread, message }`; `getThreads(channelId, includeArchived)`, `getThread`, `updateThread`, `getThreadMessages(threadId, limit?, before?)`, `sendThreadMessage(threadId, content, nonce?, replyToId?)`.

### 4.10 Reactions & pins

Channel: `addReaction`, `getReactionsRaw`, `getReactionsAggregated(messageId, currentUserId)` (FE-side `{ emoji, count, me }` aggregation), `removeReaction`. Channel pins: `pinMessage`, `unpinMessage`, `getPinnedMessages`. Read state: `markChannelRead(channelId, messageId)`, `markServerRead(serverId)`.

### 4.11 DMs

`getDms`, `openDm(userId)` (1-on-1), `createGroupDm(userIds, name?)`, `getDmMessages`, `sendDmMessage`, `editDmMessage`, `deleteDmMessage`, `hideDmMessage` (soft-delete for self), `closeDm`, `updateDm` (rename group), `leaveDm`, `markDmRead`, DM reactions (`addDmReaction`, `removeDmReaction`), DM pins (`pinDmMessage`, `unpinDmMessage`, `getDmPinnedMessages`), DM gallery (`getDmAttachments`).

DM calls: `initiateCall(dmId, { isVideo? })`, `acceptCall`, `rejectCall`, `endCall`. `is_video` is passed as a query param (`?is_video=true`).

### 4.12 Attachments

Standard: `uploadAttachment(channelId, messageId, file)`, `uploadDmAttachment(dmId, messageId, file)`. Streaming with progress (XHR): `uploadAttachmentWithProgress(channelId, messageId, file, onProgress)`, `uploadDmAttachmentWithProgress(...)`. General-purpose icon/avatar: `uploadFile(file, purpose?: 'avatar' | 'icon')` — server resizes to 256×256 WebP when a purpose is set.

`UploadProgressEvent { loaded, total }` is dispatched per `xhr.upload.onprogress`. Used because `fetch()` has no upload-progress event.

### 4.13 Invites

`createInvite(serverId, { max_uses?, max_age_seconds? })`, `getInvites`, `deleteInvite`, `useInvite(code)` — the join entry point used by `<InviteAccept />` and the deep-link handler.

### 4.14 Friends

`getFriends`, `getPendingFriends`, `sendFriendRequest`, `acceptFriend`, `declineFriend`, `blockUser`, `removeFriendByUserId(userId)` (handles the FE shortcut of removing by counterpart instead of friendship id).

### 4.15 Notifications & devices

`getNotificationSettings`, `getNotificationSetting(targetType, targetId)`, `updateNotificationSetting(targetType, targetId, body)`. Devices: `getVapidKey`, `registerDevice(body)`, `getDevices`, `deleteDevice`, `updatePushToken`.

### 4.16 Presence

`queryPresence(userIds: string[])` — chunks/maps the array into `Record<userId, status>`.

### 4.17 Audit log

`getAuditLog(serverId, { action?, limit?, before? })`.

### 4.18 Webhooks

`getChannelWebhooks`, `createWebhook`, `updateWebhook`, `deleteWebhook`, `regenerateWebhookToken`. Plaintext tokens are returned only on create + regenerate.

### 4.19 Polls

`createPoll(channelId, body)` → `{ poll, message }`, `votePoll(pollId, optionId)`, `unvotePoll(pollId, optionId)`, `getPoll`.

### 4.20 Server emojis

`getServerEmojis`, `uploadEmoji(serverId, name, file)`, `deleteEmoji`.

### 4.21 E2EE keys

- `uploadPrekeys(body)` → `POST /keys/upload` with identity + signed prekey + N one-time prekeys + optional PQ prekey
- `getPreKeyBundle(userId)` → `GET /keys/:user_id` (all devices)
- `distributeChannelKeys(channelId, body, isDm?)` — routes to `/channels/:id/e2ee/distribute` or `/dms/:id/e2ee/distribute`
- `getMyChannelKey(channelId, isDm?)` → `null` if no key yet
- `getChannelKeyGeneration(channelId)` → `{ key_generation }`

### 4.22 GIFs & oEmbed

`getGifFavorites`, `addGifFavorite(gifId)`, `removeGifFavorite(gifId)`, `searchGifs(query, limit, pos)`, `getFeaturedGifs(limit, pos)`, `getGifCategories()`, `getOembed(url)`.

GIF responses use a Tenor-v2-compatible shape (`{ results: [{ id, title, content_description, url, media_formats: { gif, tinygif } }], next? }`).

---

## 5. WebSocket gateway client (`src/api/ws.ts`)

A singleton `wsClient` instance is exported. The class exposes only the bare contract the rest of the app uses; everything else is private state.

### Public surface

```typescript
wsClient.connect();                          // idempotent; bails if no access token
wsClient.disconnect();                       // hard-close, no reconnect
wsClient.subscribe(channelId);               // refcounted — only one Subscribe per channel
wsClient.unsubscribe(channelId);             // refcounted
wsClient.sendTyping(channelId);
wsClient.updatePresence(status);             // 'online' | 'idle' | 'dnd' | 'offline'
wsClient.on((event: WsListenerEvent) => …);  // returns an unsubscribe fn
```

### Lifecycle

1. `connect()` is no-op if `this.ws` is already set or no access token is available.
2. On `open` → sends `Identify { token }` immediately.
3. On any `message` → JSON-parses `{ op, d }`, dispatches to every registered listener.
4. On `op === 'Ready'` → marks the connection ready, starts heartbeat, replays any tracked channel subscriptions.
5. Heartbeat — `setInterval` every **30 000 ms** sends `Heartbeat { seq: ++this.seq }`. Server expects one within 90 s.
6. On `close` → cleanup heartbeat, null the socket, `scheduleReconnect()`.
7. On `error` → just closes; reconnect handles the retry.

### Reconnect

Exponential backoff `min(1000 * 2^n + jitter, 60_000)` ms, max 10 attempts. Before each reconnect it calls `refreshAccessTokenIfNeeded()` because the close may have been triggered by token expiry. Once `MAX_ATTEMPTS` is reached the listener receives a synthetic `{ op: 'Disconnected', d: { reason: 'max_reconnect_attempts' } }` event so UI can show "offline".

### Subscriptions

`subscribe()` / `unsubscribe()` are refcounted: multiple hooks can subscribe to the same channel and only the first/last triggers an actual `Subscribe` / `Unsubscribe` frame. On reconnect the entire `subscribedChannels` map is replayed.

### Event handling

`WsListenerEvent` (in `src/api/ws-events.ts`) is the discriminated union of every server→client op. Stores subscribe via `wsClient.on(...)` and `switch (event.op)` to update local state. Unknown ops fall through to an `UnknownWsEvent` branch.

Built-in handling inside `WsClient.handleEvent`:

- `Ready` → flip `connected`, start heartbeat, replay subscriptions
- `HeartbeatAck` → no-op
- `Error` → `console.warn('[ws] gateway error', d.message)` (consumers can still observe via their own listener)

### Which store handles which event

| Op | Store(s) | Effect |
|----|----------|--------|
| `MessageCreate` | `messages` + `unread` | Append to channel/DM/thread feed; bump unread |
| `MessageUpdate` / `MessageDelete` | `messages` | Replace or remove |
| `ReactionUpdate` | `messages` | Replace reactions array on the message |
| `PollUpdate` | `messages` | Replace embedded poll snapshot |
| `TypingStart` | `typing` | Set a TTL'd "X is typing" entry |
| `PresenceUpdate` | `presence` | Map user → status |
| `DmCreate` / `DmUpdate` / `DmClose` / `DmMessageHide` / `DmMessagesRead` | `dm-reads`, `messages`, `servers` (DM list) | Sync DM list & messages |
| `ThreadCreate` / `ThreadUpdate` | `threads` | Sync thread list |
| `ChannelCreate` / `ChannelUpdate` / `ChannelDelete` | `servers` | Sync channel tree |
| `CategoryCreate/Update/Delete` | `servers` | Sync categories |
| `MemberJoin/Leave/Update` | `users`, `servers` | Roster updates |
| `ServerUpdate/Delete` | `servers` | Sync server metadata |
| `RoleCreate/Update/Delete` | `servers` | Sync roles; trigger permission re-fetch on `RoleUpdate` |
| `ChannelPermissionUpdate` | `servers` | Replace overwrites |
| `DmCallRing/Accept/Reject/End` + `UserCallPresence` | `call` | Drive call UI / overlays |
| `UserUpdate` | `users`, `auth` (if `user_id === me`), `locale` (if `preferred_language` present) | Profile + self-only privacy/locale sync |
| `EmailVerified` | `auth` | Refresh `me.email_verified` |
| `FriendshipUpdate` | `users` / friendship cache | Update friends panel |
| `GifFavoriteUpdate` | `gif-favorites` | Sync favorite list |
| `NotificationSettingUpdate` | `notification-settings` | Sync mute/notify state |
| `ChannelMessagesRead` / `ServerMessagesRead` | `unread` | Clear read markers |

---

## 6. Voice WebSocket & WebRTC

Source: `src/voice/voiceClient.ts`, `src/voice/voiceService.ts`, `src/voice/encryptionWorker.ts`, `src/voice/voicePrefs.ts`, `src/stores/voice.ts`, `src/stores/call.ts`.

### Voice WS client

`new VoiceClient(wsUrl).connect(token)` opens a WebSocket to `getMediaWsUrl()` and immediately sends `Identify { token }`. Returns a promise that resolves on `open` (10-second timeout, rejects otherwise).

Client → server ops:

| Op | Payload | Purpose |
|----|---------|---------|
| `Identify` | `{ token }` | Authenticate. Must be first. |
| `Join` | `{ channel_id, with_video }` | Join voice room (text-or-DM channel id) |
| `Answer` | `{ sdp }` | Reply to server `Offer` |
| `IceCandidate` | `{ candidate }` | Trickle ICE up to the SFU |
| `Leave` | `{}` | Leave room (also fired on disconnect cleanup) |
| `Mute` | `{ muted }` | Update mute state |
| `Deafen` | `{ deafened }` | Update deafen state |

Server → client ops (mapped to `VoiceEventType` strings):

| Wire op | Listener name | Payload |
|---------|---------------|---------|
| `Joined` | `joined` | `{ room_id, participants: ParticipantInfo[] }` |
| `Offer` | `offer` | `{ sdp }` |
| `IceCandidate` | `iceCandidate` | `{ candidate }` (trickle from SFU; the OP_MAP includes it even though the backend currently bundles ICE inside the Offer) |
| `ParticipantJoined` | `participantJoined` | `{ user_id, has_video, audio_mid, video_mid? }` |
| `ParticipantLeft` | `participantLeft` | `{ user_id }` |
| `MuteUpdate` | `muteUpdate` | `{ user_id, muted }` |
| `DeafenUpdate` | `deafenUpdate` | `{ user_id, deafened }` |
| `Speaking` | `speaking` | Reserved, **not currently emitted** |
| `Error` | `error` | `{ message }` |

On close with a non-1000 code, the client emits an `error` event with `WebSocket closed: {code} {reason}` so `VoiceService` can fall back / reconnect.

### Voice service (WebRTC)

`VoiceService` owns:

- One `RTCPeerConnection` per voice session
- Local `MediaStreamTrack`s (mic, optional camera, optional screenshare)
- A map of `RTCRtpTransceiver`s indexed by participant `audio_mid` / `video_mid`
- Optional voice E2EE (SFrame-style) via `encryptionWorker.ts` — encrypted frames are inserted via `RTCRtpScriptTransform` / Insertable Streams where supported.

Flow:

1. `voiceService.join(channelId, opts)` → `voiceClient.connect(token)` → `voiceClient.join(channelId, { withVideo })`.
2. Receive `Joined` → record participants, prepare transceivers.
3. Receive `Offer` → `pc.setRemoteDescription` → `pc.createAnswer` → `voiceClient.sendAnswer(sdp)`.
4. Trickle ICE both directions.
5. `ParticipantJoined` / `Left` → add or remove transceivers / playback elements.
6. `voiceService.leave()` → tear down transceivers + `voiceClient.leave()` → close socket.

User toggles `setMuted/setDeafened` propagate locally (enable/disable tracks) and to the server (`voiceClient.setMuted/setDeafened`) so other participants see the same state via `MuteUpdate` / `DeafenUpdate`.

### Stores

- **`stores/voice.ts`** — currently joined room, peer states, local mute/deafen/video state, output device.
- **`stores/call.ts`** — DM call overlays (incoming ring + outgoing dialing). Driven by `DmCallRing/Accept/Reject/End` + `UserCallPresence`.
- **`voice/voicePrefs.ts`** — persisted audio device IDs, push-to-talk binding, noise-suppression toggles.

---

## 7. E2EE crypto stack

Source: `src/crypto/` + `src/services/e2ee.ts` + `src/services/decryptQueue.ts`.

### Primitives (`src/crypto/keys.ts`)

- **Identity / signing**: Ed25519 (via `@noble/curves`)
- **Key agreement**: X25519
- **Post-quantum KEM**: ML-KEM-768 (via `@noble/post-quantum`)
- **Signed prekey** + **PQ signed prekey** signatures are both produced by the identity Ed25519 key.

Helpers: `generateIdentityKeyPair`, `generateSignedPreKey`, `generatePQSignedPreKey`, `verifySignedPreKey`, `verifyPQSignedPreKey`, `x25519KeyAgreement`, `mlkemEncapsulate`, `mlkemDecapsulate`, `toBase64`, `fromBase64`.

`LocalKeySet` is the in-memory shape:

```typescript
interface LocalKeySet {
  identity: IdentityKeyPair;
  signedPreKey: SignedPreKey;
  pqSignedPreKey: PQSignedPreKey;
  oneTimePreKeys: X25519KeyPair[];   // each one consumed by an incoming X3DH handshake
}
```

### `keyStore` (memory + storage)

Holds the active `LocalKeySet` after `initE2EE()`. The seed (32 bytes) is the only thing persisted via `storage.set('jolkr_e2ee_seed_v2', ...)`; everything else is derived from it deterministically on every boot so an attacker who reads only `localStorage` learns nothing useful.

### Per-DM session (`crypto/e2ee.ts`)

X3DH-style handshake: combine `identity_priv ⊗ peer_signed_prekey`, `eph_priv ⊗ peer_identity`, `eph_priv ⊗ peer_signed_prekey`, `eph_priv ⊗ peer_one_time_prekey` (if available), `mlkem_decapsulate(peer_pq_signed_prekey)`. Result is HKDF'd into a session key. Messages are sealed with XChaCha20-Poly1305: `nonce` (24 bytes) goes on the wire, `content` is base64 ciphertext.

### Sender keys (channels + group DMs) (`crypto/channelKeys.ts`)

Every channel has a `key_generation` number (server-side). Sender keys are XChaCha20-Poly1305 keys. The distributor encrypts the channel key per-recipient with the recipient's identity X25519 key, posts via `POST /channels/:id/e2ee/distribute` (or `/dms/:id/e2ee/distribute`). Each member fetches their copy via `GET …/e2ee/my-key` and caches it locally. On `ChannelUpdate` carrying a new `e2ee_key_generation`, the cache for that channel is invalidated and re-fetched.

`invalidateChannelKey(channelId)` and `clearAllChannelKeys()` are exported for the auth-reset path.

### Orchestrator (`services/e2ee.ts`)

```typescript
deriveE2EESeed(password, userId)   // PBKDF2 → 32 bytes
initE2EE(deviceId, seed?)          // Load seed from storage OR derive from password
resetE2EE()                         // Drop all in-memory keys + clear seed from storage
```

`initE2EE` decides whether to upload a fresh prekey bundle: it calls `GET /keys/count/:device_id`, and if the count is below the local threshold (or no prekeys exist yet) it generates new one-time prekeys and uploads via `POST /keys/upload`.

### Decrypt queue (`services/decryptQueue.ts`)

Messages decryption is offloaded to a small in-memory queue so a wave of `MessageCreate` events doesn't stall the UI. Each item resolves to `useDecryptedContent(message)` (hook) values consumed by message renderers.

---

## 8. Zustand stores

All stores live at module scope in `src/stores/`. Reset is centralised via `resetAllStores()` in `stores/reset.ts` so the logout flow can rewind every store atomically.

| Store | Purpose | Key WS events |
|-------|---------|---------------|
| `auth.ts` | `user`, `isLoading`, `loadUser`, `setUser`, `logout` | `UserUpdate` (self), `EmailVerified` |
| `servers.ts` | Server list, channels, categories, roles, overwrites, drag-positions | `ServerUpdate/Delete`, `ChannelCreate/Update/Delete`, `CategoryCreate/Update/Delete`, `MemberJoin/Leave/Update`, `RoleCreate/Update/Delete`, `ChannelPermissionUpdate` |
| `messages.ts` | Channel + DM + thread message feeds, edits, pins, embeds, reactions | `MessageCreate/Update/Delete`, `ReactionUpdate`, `PollUpdate` |
| `dm-reads.ts` | DM read receipts, last-read pointers | `DmMessagesRead`, `DmMessageHide`, `DmClose` |
| `unread.ts` | Per-channel + per-server unread counts, mention badges | `MessageCreate`, `ChannelMessagesRead`, `ServerMessagesRead` |
| `users.ts` | Cached user profiles (resolved from BE on demand) | `UserUpdate`, `FriendshipUpdate`, `PresenceUpdate` (status sync) |
| `presence.ts` | `userId → status` map (server-driven) | `PresenceUpdate` |
| `typing.ts` | `channelId → Set<userId>` with TTL | `TypingStart` |
| `threads.ts` | Thread cache per channel | `ThreadCreate`, `ThreadUpdate` |
| `voice.ts` | Active voice room state, mute/deafen, participants, audio levels | Voice WS events |
| `call.ts` | Incoming + outgoing DM call overlays | `DmCallRing/Accept/Reject/End`, `UserCallPresence` |
| `notification-settings.ts` | Per-target mute/notify prefs | `NotificationSettingUpdate` |
| `gif-favorites.ts` | Favorite GIFs cache | `GifFavoriteUpdate` |
| `locale.ts` | UI language; reads `preferred_language` from `MeProfile` | `UserUpdate.preferred_language` |
| `context-menu.ts` | Active right-click context menu | — |
| `toast.ts` | Toast notification queue | — |
| `uploadProgress.ts` | Per-attachment upload progress | — |
| `reset.ts` | `resetAllStores()` helper | — |

### Lifecycle invariants

- Stores never `import` from each other; cross-store calls use `useOtherStore.getState()` to avoid React re-renders.
- All WS-driven mutations live inside the store, not inside hooks. Hooks only `useStore(s => s.selector)`.
- `resetAllStores()` zeros every store back to its initial state on logout.

---

## 9. Services layer

Module-level orchestration that doesn't fit a single store.

| Service | Role |
|---------|------|
| `services/e2ee.ts` | `initE2EE`, `resetE2EE`, prekey replenishment |
| `services/notifications.ts` | Native browser/system notifications, mute filtering, focus checks |
| `services/pushRegistration.ts` | Web Push subscription via VAPID + `/api/devices` registration |
| `services/decryptQueue.ts` | Async decryption pipeline |
| `services/friendshipCache.ts` | Resolves friendship state for arbitrary user IDs (used by member rows) |
| `services/pinnedCache.ts` | Per-channel pin list cache |
| `services/unreadBadge.ts` | Updates the OS taskbar / dock badge in Tauri |
| `services/updater.ts` | Tauri auto-updater check + apply |
| `services/deepLink.ts` | `jolkr://invite/...` and `jolkr://add/...` handling via the Tauri deep-link plugin |

### Push registration flow

1. After login, `requestNotificationPermission()` prompts the user.
2. `registerPush()` calls `getVapidKey()` to learn the VAPID public key.
3. Web: `serviceWorkerRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → registers the subscription with `POST /api/devices` (`device_type: 'web'`, push token = stringified subscription).
4. Tauri desktop: same Web Push path because Tauri 2 embeds a real Web View.
5. Tauri mobile: `device_type: 'android' | 'ios'` and a native FCM/APNs token is supplied (hooks exist in code; full native push pipeline still in progress).

---

## 10. Hooks that touch the network

`src/hooks/` is intentionally thin — heavy state lives in stores. Notable network-aware hooks:

| Hook | Purpose |
|------|---------|
| `useAuthedFileUrl(url)` | Streams an authenticated `/api/files/:id` URL into an object URL (for `<img>`, `<video>`); cleans up on unmount |
| `useAuthedRedirectUrl(url)` | Calls `/api/files/:id/url` to get a fresh presigned URL |
| `useDecryptedContent(message)` | Drives the decrypt queue for a message |
| `useCallEvents()` | Listens to `wsClient` for `DmCallRing/Accept/Reject/End`/`UserCallPresence`, mutates `stores/call` |
| `useT()` / `tStatic()` | i18n lookup against `locale` store |
| `useLocaleFormatters()` | `Intl.DateTimeFormat` etc. bound to current locale |
| `playerRegistry.ts` | Coordinates the embedded music + video player singletons |

All other hooks are pure UI utilities (focus trap, click-outside, debounced value, viewport, shift-key).

---

## 11. App boot order & routing

### Routing

`<BrowserRouter basename={getBasename()}>` — basename is `/app` on web, `/` in Tauri.

```
/login            → <GuestGuard><Login />
/register         → <GuestGuard><Register />
/forgot-password  → <GuestGuard><ForgotPassword />
/verify-email     → <VerifyEmail />  (no guard; handles its own auth)
/invite/:code     → <InviteAccept /> (no guard)
/*                → <AuthGuard><AppShell />
*                 → <NotFound />
```

`<AuthGuard>` redirects to `/login` if no user, and to `/verify-email` if `user.email_verified === false`. `<GuestGuard>` redirects authenticated users back to `/`.

### Boot order (`App.tsx::AppInit`)

```
1. startUnreadBadge()              // Tauri badge polling
2. initTokens()                    // load tokens from secure storage
3. authStore.loadUser()            // GET /users/@me (or stays null)
4. if (accessToken) {
     requestNotificationPermission() → registerPush()
     initE2EE(localStorage[jolkr_e2ee_device_id])
     warm @nomercy-entertainment/nomercy-video-player chunk
   }
5. setTimeout(checkForUpdate, 5000) if isTauri
6. setReady(true) → unhide React tree (splash from index.html disappears)
```

The gateway is **not** connected by `AppInit`. `<AppShell />` (mounted by `<AuthGuard>`) is where `wsClient.connect()` runs in an effect, alongside `<DeepLinkHandler />` for `jolkr://` URLs.

### Logout

`authStore.logout()`:

```
1. voiceStore.leaveChannel()
2. callStore.endCall()
3. wsClient.disconnect()
4. stopNotifications() / stopUnreadBadge()
5. api.clearTokens()
6. resetE2EE()
7. resetAllStores()
8. user = null  → guards redirect to /login
```

### Tauri-specific behavior

- All browser shortcuts that interfere with desktop UX are blocked (`Ctrl+R/L/G/U/P/J/H`, `F5/F7`, `Ctrl+Shift+I` in release).
- Right-click default menu suppressed in favor of `<ContextMenu />`.
- Deep links register `jolkr://invite/:code` and `jolkr://add/:userId`.

---

## 12. Wire types (TypeScript)

Source: `src/api/types.ts` re-exports the bulk of types from `src/api/generated/` (produced by `ts-rs` from the Rust DTOs in `jolkr-core/services/*` and `jolkr-api/ws/events.rs`). FE-side overlays narrow or extend a handful of types.

### Re-exported generated types

`Attachment`, `AuditLogEntry`, `Ban`, `Category`, `ChannelOverwrite`, `DmChannel`, `DmLastMessage`, `Friendship`, `FriendshipUser`, `GifFavorite`, `Invite`, `MessageEmbed`, `NotificationSetting`, `Poll`, `PollOption`, `PreKeyBundleResponse`, `Role`, `ServerEmoji`, `Thread`, `TokenPair`, `UpdateMeBody`, `Webhook`, and the WS event types under `src/api/generated/`.

### FE overlays

```typescript
export type DmFilter = 'all' | 'friends' | 'none';

export type ChannelKind = 'text' | 'voice' | 'category';   // 'category' is FE-only legacy

export interface ServerThemeData {
  hue: number | null;
  orbs: { id: string; x: number; y: number; hue: number; scale?: number }[];
}

export type User      = Omit<GeneratedUser,      'dm_filter'> & { dm_filter: DmFilter | null };
export type MeProfile = Omit<GeneratedMeProfile, 'dm_filter'> & { dm_filter: DmFilter | null };
export type Server    = Omit<GeneratedServer,    'theme'>     & { theme?: ServerThemeData | null };

// FE adds `is_system` for forward-compat (BE not yet aware)
export type Channel  = GeneratedChannel  & { is_system?: boolean };

// FE-only `me` flag (server doesn't ship per-viewer state)
export type Reaction = GeneratedReaction & { me?: boolean };

// Message overlays — author resolution + typed poll + relaxed null shapes
export type Message = Omit<
  GeneratedMessage,
  'poll' | 'reactions' | 'thread_id' | 'thread_reply_count'
       | 'webhook_id' | 'webhook_name' | 'webhook_avatar' | 'updated_at'
> & {
  author?: User | null;
  poll?: Poll;
  reactions?: Reaction[];
  thread_id?: string | null;
  thread_reply_count?: number | null;
  webhook_id?: string | null;
  webhook_name?: string | null;
  webhook_avatar?: string | null;
  updated_at?: string | null;
};

export type Member = GeneratedMember & { user?: User };  // FE joins user via users store
```

### Why some fields are FE-resolved

`Message.author`, `Member.user` and the per-viewer `Reaction.me` are deliberately *not* on the wire — the backend ships denormalised user IDs and the FE joins them against `usersStore` so a single profile update propagates without re-syncing every message.

---

## 13. Build, env & platform detection

### Platform detection (`src/platform/detect.ts`)

```typescript
isTauri    // hasTauriInternals() at module load
isMobile() // TAURI_ENV_PLATFORM === 'android' | 'ios'  (build-time + runtime fallback)
isDesktop  // isTauri && !isMobile()
isWeb      // !isTauri
```

### Storage selection (`src/platform/storage.ts`)

`isDesktopTauri()` (Tauri + non-mobile UA) → `TauriStorage` (Stronghold). Everyone else → `WebStorage` (`localStorage`). Stronghold falls back to `localStorage` if init fails (logged).

### Vite environment variables

| Variable | Type | Meaning |
|----------|------|---------|
| `VITE_API_TARGET` | `'local'` or unset | Override Vite dev to use the local backend through the proxy |
| `VITE_DEV_MODE` | `'true'` or unset | (Tauri dev) show a server-selection screen so a developer can point the desktop app at a custom backend |
| `import.meta.env.DEV` | boolean | Vite-injected dev flag |
| `import.meta.env.BASE_URL` | string | `/app/` (web) or `/` (Tauri) |
| `__APP_VERSION__` | string | Injected at build time from `package.json` |

### Build commands

```
npm run dev            # Vite dev server
npm run build          # tsc -b && vite build  (web → dist/)
npm run build:tauri    # tsc -b && vite build --outDir dist-tauri
npm run tauri:dev      # Tauri dev with hot reload
npm run tauri:build    # Tauri desktop/mobile package
npm run verify:locales # Sanity-check locale JSON files
npm run version:bump   # Bump version across package.json + Tauri + workspace
```

---

## 14. Cloudflare upload bypass

Source: `src/platform/config.ts::getUploadBaseUrl` + nginx `jolkr-upload` template (server side).

The flow:

1. Frontend wants to POST `/api/channels/:id/messages/:mid/attachments` or `/api/dms/:id/messages/:mid/attachments` with a file up to 250 MB.
2. `uploadAttachmentWithProgress` (or the non-progress variant) calls `getUploadBaseUrl()` → returns `https://upload.jolkr.app/api` in Tauri and prod web.
3. DNS lookup for `upload.jolkr.app` resolves directly to the server IP (DNS-only A-record, no orange-cloud) — Cloudflare is bypassed for that hostname.
4. The remote nginx has a `jolkr-upload` proxy template configured **only** for those two attachment paths; every other path returns 404.
5. Backend `MAX_FILE_SIZE = 250 MB` and Axum `DefaultBodyLimit = 260 MB` apply to the actual upload.

Every other call (avatars, icons, emoji, JSON) still goes through the regular `https://jolkr.app/api/...` path so it stays behind Cloudflare's protection.

---

## 15. Migration checklist (porting to a new client)

Use this list when rebuilding the frontend in another stack. Each item maps directly to one or more sections of this doc and to the [backend reference](docs-backend-api-reference.md).

### Bootstrapping

- [ ] Detect platform (web vs Tauri vs mobile) and pick an `apiBaseUrl`, `uploadBaseUrl`, `wsUrl`, `mediaWsUrl` following §2.
- [ ] Implement secure token storage with the same fallback hierarchy: encrypted vault on desktop, OS keychain on mobile, `localStorage` on web.
- [ ] Persist the `jolkr_logged_out` flag so a returning user starts logged out after manual logout.

### Auth

- [ ] Login / register / refresh / logout / logout-all wired to §2 of the backend ref.
- [ ] JWT auto-refresh with all four triggers (proactive timer, periodic interval, visibility change, 401 handler) + 10 s dedup.
- [ ] Email verification gate (`<AuthGuard>` redirects to `/verify-email` when `email_verified === false`).
- [ ] Forgot/reset password + email verification + admin reset (`X-Admin-Secret`).

### REST surface

- [ ] Every function from §4 mapped to the same path/method/body shape (the backend reference is the authoritative endpoint list).
- [ ] Multipart uploads must omit the JSON `Content-Type` so the browser can set the multipart boundary.
- [ ] Batch user fetches must chunk on 100 IDs (server-side cap).

### WebSocket

- [ ] Identify → Ready handshake (§5).
- [ ] Heartbeat every ~30 s.
- [ ] Refcounted channel subscriptions; replay on reconnect.
- [ ] Exponential backoff reconnect with token refresh before reconnect.
- [ ] Dispatch every event op from the backend ref (§30) into a state container; gracefully ignore unknown ops.

### Voice

- [ ] Voice WS Identify + Join + Answer + ICE trickle (§6).
- [ ] WebRTC peer connection with transceivers keyed by `audio_mid` / `video_mid`.
- [ ] Optional voice E2EE worker (SFrame-style).
- [ ] DM call overlays driven by `DmCallRing/Accept/Reject/End` and `UserCallPresence`.

### E2EE

- [ ] Per-installation device ID + persistent seed.
- [ ] Local identity (Ed25519), signed prekey, one-time prekeys, PQ prekey (ML-KEM-768).
- [ ] Prekey upload on init + replenishment based on `GET /keys/count/:device_id`.
- [ ] Per-DM X3DH session keys, XChaCha20-Poly1305 sealing.
- [ ] Channel sender keys, cached per `key_generation`; re-fetch on `ChannelUpdate` if the generation changed.
- [ ] Encrypted message wire shape: `content` = base64 ciphertext, `nonce` = base64 nonce (non-null nonce signals encryption).

### Storage URLs

- [ ] Rewrite `minio:9000` → `/s3/` (or full proxy URL) on every attachment/avatar URL the FE renders (§2 `rewriteStorageUrl`).
- [ ] Authenticated streaming for `/api/files/:id` (Range support).

### UX invariants

- [ ] DM `close` and DM message `hide` are self-only — never echo to other users.
- [ ] `show_read_receipts=false` suppresses outgoing DM read receipts (BE enforces; FE simply doesn't surface the toggle for the peer).
- [ ] `MemberLeave` should drop all WS subscriptions for that user on the affected server (BE does this; FE should not assume it can still receive events for them).
- [ ] `RoleUpdate` requires the FE to re-fetch `/api/channels/:id/permissions/@me` for every affected channel.
- [ ] `preferred_language` syncs across the user's sessions via `UserUpdate`; the FE picks it up in `stores/locale`.

### Push

- [ ] VAPID public key from `/api/push/vapid-key` (no auth required).
- [ ] Subscribe via the Service Worker, send the stringified subscription to `POST /api/devices`.
- [ ] Update tokens via `PATCH /api/devices/:id/push-token`.

### Cleanup

- [ ] `resetAllStores()` analogue: every long-lived state container must be reset on logout.
- [ ] Voice + WS + push registrations torn down before tokens are cleared.

---

## Document hygiene

This file and `docs-backend-api-reference.md` must be updated in the **same PR** as any backend route / WS event / DTO change. The integration team has full latitude to reject a change that introduces drift between the docs and the code. The mirrored `jolkr-app/docs-backend-api-reference.md` is a byte-for-byte copy; keep it in sync.
