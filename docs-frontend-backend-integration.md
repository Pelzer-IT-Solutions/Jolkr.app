# Frontend ↔ Backend Integratie Documentatie

> **Versie**: 0.10.0
>
> Volledige mapping van alle koppelingen tussen `jolkr-app` (React/Vite/TypeScript) en `jolkr-server` (Rust/Axum).
> Doel: nieuwe frontend 1:1 koppelen aan dezelfde backend zonder iets te missen.

---

## Inhoudsopgave

1. [Architectuur Overzicht](#1-architectuur-overzicht)
2. [Platform & URL Configuratie](#2-platform--url-configuratie)
3. [Token & Auth Systeem](#3-token--auth-systeem)
4. [REST API Endpoints (compleet)](#4-rest-api-endpoints)
5. [WebSocket Gateway Protocol](#5-websocket-gateway-protocol)
6. [Voice WebSocket & WebRTC](#6-voice-websocket--webrtc)
7. [E2EE Crypto Systeem](#7-e2ee-crypto-systeem)
8. [Zustand Stores & State Management](#8-zustand-stores--state-management)
9. [Services](#9-services)
10. [Hooks met Backend Interactie](#10-hooks-met-backend-interactie)
11. [App Initialisatie & Routing](#11-app-initialisatie--routing)
12. [Data Types (TypeScript Interfaces)](#12-data-types)
13. [Feature Flags & Platform Detectie](#13-feature-flags--platform-detectie)
14. [Migratiechecklist](#14-migratiechecklist)

---

## 1. Architectuur Overzicht

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (jolkr-app)                                   │
│                                                         │
│  api/client.ts ──── fetch() ────► /api/*  (REST)        │
│  api/ws.ts ──────── WebSocket ──► /ws     (Gateway)     │
│  voice/voiceClient ─ WebSocket ─► /media/ws/voice       │
│  voice/voiceService─ WebRTC ────► STUN/TURN + P2P       │
│                                                         │
│  Geen axios, geen React Query, geen Redux               │
│  State: Zustand stores (module-level singletons)        │
│  Crypto: @noble/curves + @noble/post-quantum            │
└─────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌─────────────┐ ┌──────────────┐ ┌───────────────┐
│ Axum REST   │ │ WS Gateway   │ │ Media Server  │
│ /api/*      │ │ /ws          │ │ /media/ws/*   │
│ (HTTP JSON) │ │ (JSON frames)│ │ (WebRTC SFU)  │
└─────────────┘ └──────────────┘ └───────────────┘
```

**Kernbestanden:**

| Bestand | Rol |
|---------|-----|
| `src/api/client.ts` | Alle 80+ REST endpoints, token management |
| `src/api/ws.ts` | WebSocket gateway singleton |
| `src/api/types.ts` | Alle TypeScript interfaces |
| `src/platform/config.ts` | URL resolutie (web vs Tauri) |
| `src/platform/storage.ts` | Token opslag (Stronghold vs localStorage) |
| `src/voice/voiceClient.ts` | Voice signaling WebSocket |
| `src/voice/voiceService.ts` | WebRTC + voice E2EE orchestratie |

---

## 2. Platform & URL Configuratie

### Bronbestand: `src/platform/config.ts`

| Functie | Web | Tauri Desktop | Tauri Dev |
|---------|-----|---------------|-----------|
| `getApiBaseUrl()` | `/api` | `https://jolkr.app/api` | `localStorage.jolkr_server_url + /api` |
| `getWsUrl()` | `/ws` | `wss://jolkr.app/ws` | custom server URL |
| `getMediaWsUrl()` | `/media/ws/voice` | `wss://jolkr.app/media/ws/voice` | custom |
| `rewriteStorageUrl(url)` | Herschrijft `minio:9000` → `/s3/` | Herschrijft naar `https://jolkr.app/s3/` | — |

### Vite Dev Proxy (`vite.config.ts`)

```
/api  → http://localhost:8080
/ws   → ws://localhost:8080
```

### Environment Variables

| Variable | Waarde | Gebruik |
|----------|--------|---------|
| `VITE_DEV_MODE` | `true` | Tauri dev: server-selectiescherm |
| `import.meta.env.BASE_URL` | `/app/` (web) of `/` (Tauri) | Asset paths |
| `__APP_VERSION__` | uit package.json | Build-time versie |

---

## 3. Token & Auth Systeem

### Bronbestand: `src/api/client.ts`

### Token Opslag

| Platform | Methode | Details |
|----------|---------|---------|
| Tauri Desktop | Stronghold encrypted vault | `{appDataDir}/vault.hold`, random password per installatie in `sessionStorage` (legacy fallback: `io.jolkr.app`) |
| Web / Mobile | `localStorage` | Keys: `access_token`, `refresh_token` |

Extra localStorage keys:
- `jolkr_logged_out` — persistent logout flag (voorkomt token laden na refresh)
- `jolkr_e2ee_device_id` — device ID voor E2EE key upload

### Token Type: `TokenPair`

```typescript
interface TokenPair {
  access_token: string;   // JWT
  refresh_token: string;
  expires_in: number;     // seconden
}
```

### Authorization Header

Elke REST call via `request<T>()` zet automatisch:
```
Authorization: Bearer {accessToken}
Content-Type: application/json  (overgeslagen bij FormData)
```

### JWT Decode (client-side)

`isAccessTokenExpiredOrNearExpiry()`: base64-decodeert het JWT middle segment (geen signature verificatie), checkt `payload.exp`, markeert als expired als < 5 minuten over.

### Token Refresh Mechanisme

4 onafhankelijke triggers roepen allemaal `refreshAccessToken()` aan:

1. **Proactieve timer**: 30 min vóór `expires_in` (min 60s)
2. **Periodic interval**: elke 30 min check op near-expiry
3. **Visibility change**: als tab/window weer zichtbaar wordt
4. **Op 401 response**: met deduplicatie-queue (max 1 refresh per 10s)

Refresh call: `POST /api/auth/refresh` met `{ refresh_token }` body.

Bij refresh failure: tokens gewist, redirect naar `/login`.

### Login Flow

```
1. POST /api/auth/login { email, password }
   → { tokens: TokenPair }
2. setTokens(tokens) → opslaan + refresh timer starten
3. GET /api/users/@me → user state vullen
4. wsClient.connect() → WebSocket openen
5. deriveE2EESeed(password, userId) → PBKDF2
6. initE2EE(deviceId, seed) → keys genereren + uploaden
```

### Register Flow

Identiek aan login, maar met `POST /api/auth/register { email, username, password }`.

### Logout Flow

```
1. voiceStore.leaveChannel()
2. wsClient.disconnect()
3. stopNotifications()
4. api.clearTokens() → set jolkr_logged_out flag
5. resetE2EE() → wis in-memory keys + storage
6. resetAllStores() → alle Zustand stores resetten
7. user = null
```

---

## 4. REST API Endpoints

### Bronbestand: `src/api/client.ts`

Alle endpoints zijn relatief aan `getApiBaseUrl()` (standaard `/api`).

---

### 4.1 Auth

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `register` | POST | `/auth/register` | `{email, username, password}` | `{tokens: TokenPair}` |
| `login` | POST | `/auth/login` | `{email, password}` | `{tokens: TokenPair}` |
| `refreshAccessToken` | POST | `/auth/refresh` | `{refresh_token}` | `{tokens: TokenPair}` |
| `resetPassword` | POST | `/auth/reset-password` | `{email, new_password}` + Header: `X-Admin-Secret` | void |
| `forgotPassword` | POST | `/auth/forgot-password` | `{email}` | void |
| `resetPasswordConfirm` | POST | `/auth/reset-password-confirm` | `{token, new_password}` | void |
| `changePassword` | POST | `/auth/change-password` | `{current_password, new_password}` | void |

---

### 4.2 Users

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getMe` | GET | `/users/@me` | — | `{user: User}` |
| `updateMe` | PATCH | `/users/@me` | `{display_name?, bio?, avatar_url?, status?, show_read_receipts?}` | `{user: User}` |
| `getUser` | GET | `/users/{id}` | — | `{user: User}` |
| `getUsersBatch` | GET×N | `/users/{id}` (parallel `Promise.all`) | — | `User[]` |
| `searchUsers` | GET | `/users/search?q={q}` | — | `{users: User[]}` |

---

### 4.3 Servers

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getServers` | GET | `/servers` | — | `{servers: Server[]}` |
| `createServer` | POST | `/servers` | `{name, description?}` | `{server: Server}` |
| `getServer` | GET | `/servers/{id}` | — | `{server: Server}` |
| `updateServer` | PATCH | `/servers/{id}` | `{name?, description?, icon_url?, is_public?}` | `{server: Server}` |
| `deleteServer` | DELETE | `/servers/{id}` | — | void |
| `getServerMembers` | GET | `/servers/{id}/members` | — | `{members: Member[]}` |
| `getMembersWithRoles` | GET | `/servers/{id}/members-with-roles` | — | `{members: Member[]}` |
| `leaveServer` | DELETE | `/servers/{id}/members/@me` | — | void |
| `reorderServers` | PUT | `/users/@me/servers/reorder` | `{server_ids: string[]}` | void |
| `discoverServers` | GET | `/servers/discover?limit={n}&offset={n}` | — | `{servers: Server[]}` |
| `joinPublicServer` | POST | `/servers/{id}/join` | — | void |
| `getMyPermissions` | GET | `/servers/{id}/permissions/@me` | — | `{permissions: number}` |
| `markServerRead` | POST | `/servers/{id}/read-all` | — | void |

---

### 4.4 Server Moderatie

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `kickMember` | DELETE | `/servers/{id}/members/{userId}` | — | void |
| `banMember` | POST | `/servers/{id}/bans` | `{user_id, reason?}` | `{ban: Ban}` |
| `unbanMember` | DELETE | `/servers/{id}/bans/{userId}` | — | void |
| `getBans` | GET | `/servers/{id}/bans` | — | `{bans: Ban[]}` |
| `setNickname` | PATCH | `/servers/{id}/members/{userId}/nickname` | `{nickname}` | void |
| `timeoutMember` | POST | `/servers/{id}/members/{userId}/timeout` | `{timeout_until: ISO8601}` | void |
| `removeTimeout` | DELETE | `/servers/{id}/members/{userId}/timeout` | — | void |

---

### 4.5 Categories

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getCategories` | GET | `/servers/{id}/categories` | — | `{categories: Category[]}` |
| `createCategory` | POST | `/servers/{id}/categories` | `{name}` | `{category: Category}` |
| `updateCategory` | PATCH | `/categories/{id}` | `{name?, position?}` | `{category: Category}` |
| `deleteCategory` | DELETE | `/categories/{id}` | — | void |

---

### 4.6 Roles

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getRoles` | GET | `/servers/{id}/roles` | — | `{roles: Role[]}` |
| `createRole` | POST | `/servers/{id}/roles` | `{name, color?, permissions?}` | `{role: Role}` |
| `updateRole` | PATCH | `/roles/{id}` | `{name?, color?, position?, permissions?}` | `{role: Role}` |
| `deleteRole` | DELETE | `/roles/{id}` | — | void |
| `assignRole` | PUT | `/servers/{id}/roles/{roleId}/members` | `{user_id}` | void |
| `removeRole` | DELETE | `/servers/{id}/roles/{roleId}/members/{userId}` | — | void |

---

### 4.7 Channels

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getChannels` | GET | `/servers/{id}/channels/list` | — | `{channels: Channel[]}` |
| `createChannel` | POST | `/servers/{id}/channels` | `{name, kind?, topic?, category_id?}` | `{channel: Channel}` |
| `getChannel` | GET | `/channels/{id}` | — | `{channel: Channel}` |
| `updateChannel` | PATCH | `/channels/{id}` | `{name?, topic?, category_id?, is_nsfw?, slowmode_seconds?}` | `{channel: Channel}` |
| `reorderChannels` | PUT | `/servers/{id}/channels/reorder` | `{channel_positions: [{id, position}]}` | `{channels: Channel[]}` |
| `deleteChannel` | DELETE | `/channels/{id}` | — | void |
| `getMyChannelPermissions` | GET | `/channels/{id}/permissions/@me` | — | `{permissions: number}` |
| `getChannelOverwrites` | GET | `/channels/{id}/overwrites` | — | `{overwrites: ChannelOverwrite[]}` |
| `upsertChannelOverwrite` | PUT | `/channels/{id}/overwrites` | `{target_type, target_id, allow, deny}` | `{overwrite: ChannelOverwrite}` |
| `deleteChannelOverwrite` | DELETE | `/channels/{id}/overwrites/{targetType}/{targetId}` | — | void |

---

### 4.8 Messages

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getMessages` | GET | `/channels/{id}/messages?limit={n}&before={datetime?}` | — | `{messages: Message[]}` |
| `sendMessage` | POST | `/channels/{id}/messages` | `{content, nonce?, reply_to_id?}` | `{message: Message}` |
| `editMessage` | PATCH | `/messages/{id}` | `{content, nonce?}` | `{message: Message}` |
| `deleteMessage` | DELETE | `/messages/{id}` | — | void |
| `searchMessages` | GET | `/channels/{id}/messages/search?q={q}&limit={n}` | — | `{messages: Message[]}` |
| `searchMessagesAdvanced` | GET | `/channels/{id}/messages/search?{q,from,has,before,after,limit}` | — | `{messages: Message[], total: number}` |
| `pinMessage` | POST | `/channels/{id}/pins/{messageId}` | — | `{message: Message}` |
| `unpinMessage` | DELETE | `/channels/{id}/pins/{messageId}` | — | `{message: Message}` |
| `getPinnedMessages` | GET | `/channels/{id}/pins` | — | `{messages: Message[]}` |
| `markChannelRead` | POST | `/channels/{id}/read` | `{message_id}` | void |

---

### 4.9 Attachments & Upload

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getMessageAttachments` | GET | `/messages/{id}/attachments` | — | `{attachments: Attachment[]}` |
| `uploadAttachment` | POST | `/channels/{id}/messages/{msgId}/attachments` | `FormData {file}` | `{attachment: Attachment}` |
| `uploadDmAttachment` | POST | `/dms/{id}/messages/{msgId}/attachments` | `FormData {file}` | `{attachment: Attachment}` |
| `uploadFile` | POST | `/upload?purpose={avatar\|icon}` | `FormData {file}` | `{key: string, url: string}` |

---

### 4.10 DMs (Direct Messages)

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getDms` | GET | `/dms` | — | `{channels: DmChannel[]}` |
| `openDm` | POST | `/dms` | `{user_id}` | `{channel: DmChannel}` |
| `createGroupDm` | POST | `/dms` | `{user_ids, name?}` | `{channel: DmChannel}` |
| `getDmMessages` | GET | `/dms/{id}/messages?limit={n}&before={datetime?}` | — | `{messages: Message[]}` |
| `sendDmMessage` | POST | `/dms/{id}/messages` | `{content, nonce?, reply_to_id?}` | `{message: Message}` |
| `editDmMessage` | PATCH | `/dms/messages/{id}` | `{content, nonce?}` | `{message: Message}` |
| `deleteDmMessage` | DELETE | `/dms/messages/{id}` | — | void |
| `pinDmMessage` | POST | `/dms/{id}/pins/{messageId}` | — | `{message: Message}` |
| `unpinDmMessage` | DELETE | `/dms/{id}/pins/{messageId}` | — | `{message: Message}` |
| `getDmPinnedMessages` | GET | `/dms/{id}/pins` | — | `{messages: Message[]}` |
| `addDmMember` | PUT | `/dms/{id}/members` | `{user_id}` | `{channel: DmChannel}` |
| `leaveDm` | DELETE | `/dms/{id}/members/@me` | — | void |
| `closeDm` | POST | `/dms/{id}/close` | — | void |
| `updateDm` | PATCH | `/dms/{id}` | `{name?}` | `{channel: DmChannel}` |
| `markDmRead` | POST | `/dms/{id}/read` | `{message_id}` | void |

---

### 4.11 DM Call Signaling

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `initiateCall` | POST | `/dms/{id}/call` | — | void |
| `acceptCall` | POST | `/dms/{id}/call/accept` | — | void |
| `rejectCall` | POST | `/dms/{id}/call/reject` | — | void |
| `endCall` | POST | `/dms/{id}/call/end` | — | void |

---

### 4.12 Reactions

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `addReaction` | POST | `/messages/{id}/reactions` | `{emoji}` | void |
| `removeReaction` | DELETE | `/messages/{id}/reactions/{emoji}` | — | void |
| `getReactionsRaw` | GET | `/messages/{id}/reactions` | — | `{reactions: RawReaction[]}` |
| `addDmReaction` | POST | `/dms/messages/{id}/reactions` | `{emoji}` | void |
| `removeDmReaction` | DELETE | `/dms/messages/{id}/reactions/{emoji}` | — | void |
| `getDmReactionsRaw` | GET | `/dms/messages/{id}/reactions` | — | `{reactions: RawReaction[]}` |

`getReactionsAggregated` en `getDmReactionsAggregated` zijn client-side computed: backend retourneert raw rows (`{id, message_id, user_id, emoji, created_at}[]`), frontend aggregeert naar `{emoji, count, me}[]`.

---

### 4.13 Invites

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `createInvite` | POST | `/servers/{id}/invites` | `{max_uses?, max_age_seconds?}` | `{invite: Invite}` |
| `getInvites` | GET | `/servers/{id}/invites` | — | `{invites: Invite[]}` |
| `deleteInvite` | DELETE | `/servers/{id}/invites/{inviteId}` | — | void |
| `useInvite` | POST | `/invites/{code}` | — | `{invite: Invite}` |

> **Invite create body**: `{max_uses?: number, max_age_seconds?: number}` — beide optioneel.

---

### 4.14 Friends

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getFriends` | GET | `/friends` | — | `{friendships: Friendship[]}` |
| `getPendingFriends` | GET | `/friends/pending` | — | `{friendships: Friendship[]}` |
| `sendFriendRequest` | POST | `/friends` | `{user_id}` | `{friendship: Friendship}` |
| `acceptFriend` | POST | `/friends/{id}/accept` | — | `{friendship: Friendship}` |
| `declineFriend` | DELETE | `/friends/{id}` | — | void |
| `blockUser` | POST | `/friends/block` | `{user_id}` | `{friendship: Friendship}` |
| `removeFriendByUserId` | DELETE | `/friends/user/{userId}` | — | void | ⚠️ Geen backend route — client-only |

---

### 4.15 Threads

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `createThread` | POST | `/channels/{id}/threads` | `{message_id: string, name?: string}` | `{thread: Thread, message: Message}` |
| `getThreads` | GET | `/channels/{id}/threads?include_archived={bool}` | — | `{threads: Thread[]}` |
| `getThread` | GET | `/threads/{id}` | — | `{thread: Thread}` |
| `updateThread` | PATCH | `/threads/{id}` | `{name?, is_archived?}` | `{thread: Thread}` |
| `getThreadMessages` | GET | `/threads/{id}/messages?limit={n}&before={datetime?}` | — | `{messages: Message[]}` |
| `sendThreadMessage` | POST | `/threads/{id}/messages` | `{content, nonce?, reply_to_id?}` | `{message: Message}` |

---

### 4.16 Polls

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `createPoll` | POST | `/channels/{id}/polls` | `{question, options: string[], multi_select?, anonymous?, expires_at?: ISO8601}` | `{poll: Poll, message: Message}` |
| `votePoll` | POST | `/polls/{id}/vote` | `{option_id}` | `{poll: Poll}` |
| `unvotePoll` | DELETE | `/polls/{id}/vote` | `{option_id}` | `{poll: Poll}` |
| `getPoll` | GET | `/polls/{id}` | — | `{poll: Poll}` |

---

### 4.17 Webhooks

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getChannelWebhooks` | GET | `/channels/{id}/webhooks` | — | `{webhooks: Webhook[]}` |
| `createWebhook` | POST | `/channels/{id}/webhooks` | `{name, avatar_url?}` | `{webhook: Webhook}` |
| `updateWebhook` | PATCH | `/webhooks/{id}` | `{name?, avatar_url?}` | `{webhook: Webhook}` |
| `deleteWebhook` | DELETE | `/webhooks/{id}` | — | void |
| `regenerateWebhookToken` | POST | `/webhooks/{id}/token` | — | `{webhook: Webhook}` |

---

### 4.18 Server Emojis

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getServerEmojis` | GET | `/servers/{id}/emojis` | — | `{emojis: ServerEmoji[]}` |
| `uploadEmoji` | POST | `/servers/{id}/emojis` | `FormData {name, file}` | `{emoji: ServerEmoji}` |
| `deleteEmoji` | DELETE | `/emojis/{id}` | — | void |

---

### 4.19 Push & Devices

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getVapidKey` | GET | `/push/vapid-key` | — | `{public_key: string}` |
| `registerDevice` | POST | `/devices` | `{device_id?, device_name, device_type, push_token?}` | `{device: {id}}` |
| `getDevices` | GET | `/devices` | — | `{devices: Device[]}` |
| `deleteDevice` | DELETE | `/devices/{id}` | — | void |
| `updatePushToken` | PATCH | `/devices/{id}/push-token` | `{push_token}` | void |

---

### 4.20 E2EE Keys

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `uploadPrekeys` | POST | `/keys/upload` | `{device_id, identity_key, signed_prekey, signed_prekey_signature, one_time_prekeys[], pq_signed_prekey?, pq_signed_prekey_signature?}` | `{message, prekey_count}` |
| `getPreKeyBundle` | GET | `/keys/{userId}` | — | `PreKeyBundleResponse` |
| `distributeChannelKeys` | POST | `/channels/{id}/e2ee/distribute` of `/dms/{id}/e2ee/distribute` | `{key_generation, recipients: [{user_id, encrypted_key, nonce}]}` | `{ok: boolean}` |
| `getMyChannelKey` | GET | `/channels/{id}/e2ee/my-key` of `/dms/{id}/e2ee/my-key` | — | `{encrypted_key, nonce, key_generation, distributor_user_id}` of null |
| `getChannelKeyGeneration` | GET | `/channels/{id}/e2ee/generation` | — | `{key_generation: number}` |

---

### 4.21 Notification Settings

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `getNotificationSettings` | GET | `/users/me/notifications` | — | `{settings: NotificationSetting[]}` |
| `getNotificationSetting` | GET | `/users/me/notifications/{type}/{id}` | — | `NotificationSetting` |
| `updateNotificationSetting` | PUT | `/users/me/notifications/{type}/{id}` | `{muted, mute_until?, suppress_everyone?}` | `NotificationSetting` |

---

### 4.22 Overig

| Functie | Method | Path | Body | Response |
|---------|--------|------|------|----------|
| `queryPresence` | POST | `/presence/query` | `{user_ids: string[]}` | `{presences: [{user_id, status}]}` |
| `getAuditLog` | GET | `/servers/{id}/audit-log?action?&limit?&before?` | — | `{entries: AuditLogEntry[]}` |

---

### 4.23 Backend routes zonder client.ts functie

De volgende backend routes bestaan maar hebben geen dedicated wrapper in `src/api/client.ts`:

| Method | Path | Omschrijving |
|--------|------|-------------|
| GET | `/avatars/{userId}` | Publiek avatar endpoint (geen auth, direct via URL) |
| GET | `/icons/{serverId}` | Publiek server icon endpoint (geen auth, direct via URL) |
| GET | `/channels/{id}/messages` | Berichten ophalen (client gebruikt query params via `getMessages`) |
| GET | `/channels/{id}/e2ee/my-key` | E2EE key ophalen (client gebruikt `getMyChannelKey` helper) |
| GET | `/dms/{id}/messages` | DM berichten ophalen (client gebruikt `getDmMessages`) |
| GET | `/dms/{id}/e2ee/my-key` | DM E2EE key ophalen (client gebruikt `getMyChannelKey` helper) |
| GET | `/devices` | Apparaten ophalen (client gebruikt `getDevices`) |
| GET | `/keys/{userId}/{deviceId}` | PreKey bundle ophalen (client gebruikt `getPreKeyBundle`) |
| GET | `/keys/count/{deviceId}` | One-time prekey count (client controleert niet actief) |
| GET | `/threads/{id}/messages` | Thread berichten ophalen (client gebruikt `getThreadMessages`) |
| POST | `/auth/logout` | Sessie invalideren (client roept via `clearTokens` flow) |
| POST | `/auth/logout-all` | Alle sessies invalideren (geen directe client wrapper) |
| POST | `/auth/refresh` | Token refresh (client gebruikt `refreshAccessToken` intern) |
| POST | `/channels/{id}/e2ee/distribute` | E2EE keys distribueren (client gebruikt `distributeChannelKeys`) |
| POST | `/dms/{id}/e2ee/distribute` | DM E2EE keys distribueren (client gebruikt `distributeChannelKeys`) |
| POST | `/presence/query` | Presence opvragen (client gebruikt `queryPresence`) |
| POST | `/users/batch` | Meerdere users ophalen (client gebruikt parallel `getUser` calls) |
| POST | `/webhooks/{id}/{token}` | Webhook uitvoeren (geen auth, extern aangeroepen) |

---

## 5. WebSocket Gateway Protocol

### Bronbestand: `src/api/ws.ts`

### Verbinding

- URL: `getWsUrl()` → `/ws` (web) of `wss://jolkr.app/ws` (Tauri)
- Protocol: JSON frames `{ "op": "<EventName>", "d": { ...payload } }`
- Auth: na `onopen` → `{ "op": "Identify", "d": { "token": "<jwt>" } }`
- Server antwoordt met `{ "op": "Ready" }` na succesvolle auth
- Heartbeat: elke 30s → `{ "op": "Heartbeat", "d": { "seq": N } }`, server antwoordt met `HeartbeatAck`

### Reconnectie

- Exponential backoff met jitter: `min(1000 × 2^attempt + random(0..1000), 60000)` ms
- Max 10 pogingen, daarna synthetisch `Disconnected` event
- Vóór elke reconnect: `refreshAccessTokenIfNeeded()`
- Channel subscriptions blijven bewaard in `Map<channelId, refcount>` en worden op `Ready` opnieuw verstuurd

### Client → Server Events

| Op | Payload | Wanneer |
|----|---------|---------|
| `Identify` | `{ token: string }` | Na WS open |
| `Heartbeat` | `{ seq: number }` | Elke 30s |
| `Subscribe` | `{ channel_id: string }` | Channel view geopend (refcount 0→1) |
| `Unsubscribe` | `{ channel_id: string }` | Channel view gesloten (refcount→0) |
| `TypingStart` | `{ channel_id: string }` | User typt (throttled 3s) |
| `PresenceUpdate` | `{ status: string }` | Status wijziging (online/idle/dnd/offline) |

### Server → Client Events

| Op | Payload `d` | Consumer(s) |
|----|-------------|-------------|
| `Ready` | _(leeg)_ | `ws.ts` (re-subscribe), `Layout.tsx` (banner weg) |
| `HeartbeatAck` | _(leeg)_ | `ws.ts` (no-op) |
| `MessageCreate` | `{ message: Message }` | `stores/messages.ts`, `stores/unread.ts`, `services/notifications.ts`, `DmList.tsx` |
| `MessageUpdate` | `{ message: Message }` | `stores/messages.ts` |
| `MessageDelete` | `{ message_id, channel_id?, dm_channel_id? }` | `stores/messages.ts` |
| `ReactionUpdate` | `{ channel_id, message_id, reactions[] }` | `stores/messages.ts` |
| `PollUpdate` | `{ poll, message_id, channel_id }` | `stores/messages.ts` |
| `ThreadCreate` | _(any)_ | `stores/messages.ts` (threadListVersion++) |
| `ThreadUpdate` | _(any)_ | `stores/messages.ts` (threadListVersion++) |
| `PresenceUpdate` | `{ user_id, status }` | `stores/presence.ts` |
| `TypingStart` | `{ channel_id, user_id }` | `stores/typing.ts` (5s TTL) |
| `ChannelCreate` | `{ channel: Channel }` | `stores/servers.ts` |
| `ChannelUpdate` | `{ channel: Channel }` | `stores/servers.ts` |
| `ChannelDelete` | `{ channel_id, server_id }` | `stores/servers.ts` |
| `MemberJoin` | `{ server_id, user_id }` | `stores/servers.ts` |
| `MemberLeave` | `{ server_id, user_id }` | `stores/servers.ts` |
| `MemberUpdate` | `{ server_id, user_id, timeout_until? }` | `stores/servers.ts` (+ permission cache invalidatie) |
| `ServerUpdate` | `{ server: Server }` | `stores/servers.ts` |
| `ServerDelete` | `{ server_id }` | `stores/servers.ts` |
| `UserUpdate` | `{ status?, display_name?, avatar_url?, bio? }` | `stores/auth.ts` |
| `DmMessagesRead` | `{ dm_id, user_id, message_id }` | `stores/unread.ts`, `stores/dm-reads.ts` |
| `DmCreate` | `{ channel?: DmChannel }` | `DmList.tsx` |
| `DmUpdate` | `{ channel: DmChannel }` | `DmList.tsx`, `DmChat.tsx` |
| `CategoryCreate` | `{ category: Category }` | `stores/servers.ts` |
| `CategoryUpdate` | `{ category: Category }` | `stores/servers.ts` |
| `CategoryDelete` | `{ category_id, server_id }` | `stores/servers.ts` |
| `ChannelMessagesRead` | `{ channel_id, user_id, message_id }` | `stores/unread.ts` |
| `ServerMessagesRead` | `{ server_id, user_id }` | `stores/unread.ts` |
| `DmCallRing` | `{ dm_id, caller_id, caller_username }` | `hooks/useCallEvents.ts` |
| `DmCallAccept` | `{ dm_id }` | `hooks/useCallEvents.ts` |
| `DmCallReject` | `{ dm_id }` | `hooks/useCallEvents.ts` |
| `DmCallEnd` | `{ dm_id }` | `hooks/useCallEvents.ts` |

### Channel Subscription (refcount systeem)

```
subscribe(channelId):   refcount++ → op 0→1: stuur Subscribe
unsubscribe(channelId): refcount-- → op →0: stuur Unsubscribe
Bij Ready event:        alle channels in Map re-subscriben
```

Gebruikt door `MessageList.tsx` (mount/unmount).

---

## 6. Voice WebSocket & WebRTC

### Bronbestanden: `src/voice/voiceClient.ts`, `src/voice/voiceService.ts`

### Voice Signaling WebSocket

- URL: `getMediaWsUrl()` → `/media/ws/voice`
- Auth: zelfde `Identify` pattern als main gateway
- Geen reconnectie (als WS valt maar WebRTC draait, blijft audio actief)

#### Client → Media Server

| Op | Payload |
|----|---------|
| `Identify` | `{ token: string }` |
| `Join` | `{ channel_id: string }` |
| `Answer` | `{ sdp: string }` |
| `IceCandidate` | `{ candidate: string }` |
| `Leave` | `{}` |
| `Mute` | `{ muted: boolean }` |
| `Deafen` | `{ deafened: boolean }` |

#### Media Server → Client

| Op | Payload |
|----|---------|
| `Joined` | `{ participants: [{user_id, is_muted, is_deafened}] }` |
| `Offer` | `{ sdp: string }` |
| `IceCandidate` | `{ candidate: string }` |
| `ParticipantJoined` | `{ user_id }` |
| `ParticipantLeft` | `{ user_id }` |
| `MuteUpdate` | `{ user_id, muted }` |
| `DeafenUpdate` | `{ user_id, deafened }` |
| `Speaking` | `{ user_id, speaking }` |
| `Error` | `{ message }` |

### WebRTC

- STUN server: `stun:stun.l.google.com:19302`
- SFU model: server stuurt SDP Offer, client antwoordt met Answer
- ICE candidates worden uitgewisseld via voice WS

### Voice E2EE

- Worker: `src/voice/encryptionWorker.ts` (Web Worker via `RTCRtpScriptTransform`)
- Key: voor server voice channels → channel shared key; voor DM calls → pairwise X25519 DH
- KDF: `HKDF-SHA256(channelKeyBytes, salt=zero[32], info="jolkr-voice-e2ee-v1")` → AES-256-GCM
- IV: `SSRC(4B BE) || counter(4B LE) || zeros(4B)` — voorkomt collision bij meerdere deelnemers
- Frame format: `[AES-GCM ciphertext + 16B tag] [4B counter LE]`

---

## 7. E2EE Crypto Systeem

### Bronbestanden: `src/crypto/`, `src/services/e2ee.ts`

### Libraries

- `@noble/curves/ed25519` — Ed25519 signing + X25519 ECDH
- `@noble/post-quantum/ml-kem` — ML-KEM-768 (post-quantum KEM)

### Key Types

| Type | Algoritme | Gebruik |
|------|-----------|---------|
| `IdentityKeyPair` | Ed25519 | Signing (signature verificatie) |
| `SignedPreKey` | X25519 + Ed25519 sig | ECDH key exchange |
| `PQSignedPreKey` | ML-KEM-768 + Ed25519 sig | Post-quantum KEM |

### Deterministische Key Generatie (login)

```
1. PBKDF2-SHA256(password, "jolkr-e2ee-v2:" + userId, 210000 iterations) → 256-bit seed
2. HKDF-SHA256(seed, info="jolkr-e2ee-identity-ed25519") → Ed25519 private key
3. HKDF-SHA256(seed, info="jolkr-e2ee-signedprekey-x25519") → X25519 private key
4. HKDF-SHA256(seed, info="jolkr-e2ee-pqprekey-mlkem768", 512 bits) → ML-KEM-768 seed → keygen
5. Sign X25519 public key met Ed25519 → signed prekey
6. Sign ML-KEM encapsulation key met Ed25519 → pq signed prekey
```

### Key Opslag

Via `src/crypto/keyStore.ts` → `src/platform/storage.ts`:
- Desktop: Stronghold encrypted vault
- Web: localStorage (base64 encoded)

Storage keys: `e2ee_identity_pub`, `e2ee_identity_priv`, `e2ee_signed_prekey_pub`, `e2ee_signed_prekey_priv`, `e2ee_signed_prekey_sig`, `e2ee_pq_encapsulation_key`, `e2ee_pq_decapsulation_key`, `e2ee_pq_signature`

### Key Upload

Na login/register:
1. `POST /api/devices` — device registreren
2. `POST /api/keys/upload` — public keys + signatures uploaden
3. Flag `e2ee_keys_uploaded` in storage gezet (1x per sessie)

### DM Encryptie (per-bericht asymmetrisch)

```
Encrypt:
1. Fetch recipient PreKeyBundle (GET /keys/{userId}, 5min cache)
2. Verify signed prekey signature (Ed25519)
3. Genereer ephemeral X25519 keypair
4. X25519 DH: ephemeralPriv × recipient.signedPrekey → classicalShared
5. ML-KEM-768 encapsulate(recipient.pqKey) → pqCiphertext + pqShared
6. HKDF-SHA256(classicalShared || pqShared, info="jolkr-e2ee-hybrid-v1") → AES key
7. AES-256-GCM encrypt met 12-byte random nonce
8. Pack: version(0x03) || ephemeralPub(32B) || pqCiphertext(1088B) || ciphertext

Decrypt:
1. Lees version byte → route naar juiste KDF
2. Unpack ephemeralPub + pqCiphertext + ciphertext
3. X25519 DH: mySignedPrekeyPriv × ephemeralPub → classicalShared
4. ML-KEM-768 decapsulate(myDecapsKey, pqCiphertext) → pqShared
5. Zelfde HKDF → AES key → AES-GCM decrypt
```

### Version Bytes

| Byte | KDF | Quantum | Status |
|------|-----|---------|--------|
| `0x03` | HKDF-SHA256 | Ja (hybrid X25519 + ML-KEM-768) | **Enige supported versie** |

> Legacy versies `0x01` (classical) en `0x02` (SHA-256 hybrid) zijn verwijderd. Alleen v0x03 wordt ondersteund.

### Channel/Group Encryptie (shared symmetric key)

```
1. GET /channels/{id}/e2ee/my-key → encrypted channel key (of null)
2. Als null: genereer 32 random bytes, encrypt voor elke member via DM E2EE
3. POST /channels/{id}/e2ee/distribute met per-recipient ciphertexts
4. Encrypt berichten: AES-256-GCM met channel key + random nonce
5. Cache: in-memory Map<channelId, CachedChannelKey> (geen TTL, gewist bij logout)
6. Key rotation: server tracked key_generation integer
```

### Safety Numbers

`SHA-256(sorted(identityKey_A || identityKey_B))` → 60 decimale cijfers, 12 groepen van 5.

---

## 8. Zustand Stores & State Management

Geen Redux, geen React Query. Alle state in Zustand stores (module-level singletons).

### 8.1 `useAuthStore` (`stores/auth.ts`)

| State | Type |
|-------|------|
| `user` | `User \| null` |
| `loading` | `boolean` |
| `error` | `string \| null` |

| Action | API calls |
|--------|-----------|
| `login(email, pw)` | `api.login`, `api.getMe`, `wsClient.connect` |
| `register(email, user, pw)` | `api.register`, `api.getMe`, `wsClient.connect` |
| `loadUser()` | `api.getMe`, `wsClient.connect` |
| `updateProfile(data)` | `api.updateMe` |
| `logout()` | `wsClient.disconnect`, `api.clearTokens`, `resetE2EE`, `resetAllStores` |

WS listener: `UserUpdate` → patcht eigen user object.

### 8.2 `useServersStore` (`stores/servers.ts`)

| State | Type |
|-------|------|
| `servers` | `Server[]` |
| `channels` | `Record<serverId, Channel[]>` |
| `members` | `Record<serverId, Member[]>` |
| `categories` | `Record<serverId, Category[]>` |
| `roles` | `Record<serverId, Role[]>` |
| `permissions` | `Record<serverId, number>` |
| `channelPermissions` | `Record<channelId, number>` |
| `emojis` | `Record<serverId, ServerEmoji[]>` |

WS listeners: `ChannelCreate/Update/Delete`, `CategoryCreate/Update/Delete`, `MemberJoin/Leave/Update`, `ServerUpdate/Delete`.

Cache: skip fetch als data al geladen; permission cache invalidatie bij eigen role wijziging.

### 8.3 `useMessagesStore` (`stores/messages.ts`)

| State | Type |
|-------|------|
| `messages` | `Record<channelId, Message[]>` |
| `loading/loadingOlder/hasMore` | per channel |
| `threadMessages/threadLoading/...` | parallel voor threads |
| `threadListVersion` | `number` (increment = re-fetch trigger) |

LRU cache: max 30 kanalen (`MAX_CACHED_CHANNELS`).

`normalizeWsMessage()`: canonical message shape voor WS events.

`transformReactions()`: maps backend `user_ids[]` → `me: boolean`.

WS listeners: `MessageCreate/Update/Delete`, `ThreadCreate/Update`, `ReactionUpdate`, `PollUpdate`.

### 8.4 `usePresenceStore` (`stores/presence.ts`)

| State | Type |
|-------|------|
| `presence` | `Record<userId, 'online' \| 'idle' \| 'offline'>` |

Geen API calls — puur WS-driven (`PresenceUpdate` event).

### 8.11 `useTypingStore` (`stores/typing.ts`)

| State | Type |
|-------|------|
| `typing` | `Record<channelId, Record<userId, TypingEntry>>` |

WS: `TypingStart` → track per-channel typing. Auto-clear na 5s. Selector `useTypingUsers(channelId, ownUserId)` filtert eigen user.

### 8.5 `useVoiceStore` (`stores/voice.ts`)

| State | Type |
|-------|------|
| `connectionState` | string |
| `channelId/serverId/channelName` | string |
| `isMuted/isDeafened` | boolean |
| `participants` | array |
| `error` | string |

Gebruikt `VoiceService` singleton, geen REST API.

### 8.6 `useCallStore` (`stores/call.ts`)

| State | Type |
|-------|------|
| `incomingCall` | object |
| `outgoingCall` | object |
| `activeCallDmId` | string |

API calls: `api.initiateCall`, `acceptCall`, `rejectCall`, `endCall`.

60s ring timer. Cross-store subscription naar `useVoiceStore`.

### 8.7 `useUnreadStore` (`stores/unread.ts`)

| State | Type |
|-------|------|
| `counts` | `Record<channelId, number>` |
| `activeChannel` | `string \| null` |
| `lastSeenMessageId` | `Record<channelId, string>` (localStorage `jolkr_last_seen`) |

| Action | Beschrijving |
|--------|-------------|
| `increment(channelId)` | +1 als user niet in dat kanaal zit |
| `markRead(channelId)` | Reset count naar 0 |
| `setActiveChannel(channelId)` | Markeert kanaal als gelezen, slaat last seen op |
| `markServerRead(channelIds)` | Clear counts voor meerdere kanalen tegelijk |

WS: `MessageCreate` (increment), `DmMessagesRead` (mark read), `ChannelMessagesRead` (sync read state), `ServerMessagesRead` (clear all counts).

### 8.8 `useDmReadsStore` (`stores/dm-reads.ts`)

| State | Type |
|-------|------|
| `readStates` | `Record<dmId, Record<userId, messageId>>` |

WS: `DmMessagesRead` — voor read receipt rendering.

### 8.9 `useContextMenuStore` (`stores/context-menu.ts`)

Pure UI state. Geen backend interactie.

### 8.10 `resetAllStores` (`stores/reset.ts`)

Utility functie die `.reset()` / `.clearAll()` aanroept op alle stores. Aangeroepen door `logout()`.

---

## 9. Services

### 9.1 `services/e2ee.ts`

E2EE lifecycle: init, key generatie, upload, bundle caching, encrypt/decrypt.

API calls: `api.registerDevice`, `api.uploadPrekeys`, `api.getPreKeyBundle`.

Bundle cache: `Map<userId, CachedBundle>` (5min TTL valid, 10s TTL null).

Één key set in memory: `localKeys` (HKDF-derived). Legacy SHA-256 keys zijn verwijderd — alleen v0x03 hybrid X25519+ML-KEM-768 wordt ondersteund.

### 9.2 `services/notifications.ts`

In-app notification: Web Audio API (geen externe bestanden) + desktop `Notification API`.

WS listener: `MessageCreate` → geluid + notification voor niet-actieve channels; skipt eigen berichten.

Respecteert localStorage prefs: `jolkr_sound`, `jolkr_desktop_notif`.

### 9.3 `services/pushRegistration.ts`

Web Push: `navigator.serviceWorker.register('/app/sw.js')` → `pushManager.subscribe`.

API calls: `api.getVapidKey`, `api.registerDevice`, `api.deleteDevice`.

Device ID: `localStorage.jolkr_push_device_id`.

Skipt op Tauri desktop.

### 9.4 `services/deepLink.ts`

Tauri only. Registreert `jolkr://` URL handler.

Ondersteunt: `jolkr://invite/{code}` → `api.useInvite`, `jolkr://add/{userId}` → `api.sendFriendRequest`.

### 9.5 `services/updater.ts`

Tauri only. Auto-updater via `@tauri-apps/plugin-updater`.

---

## 10. Hooks met Backend Interactie

### `useCallEvents` (`hooks/useCallEvents.ts`)

WS events: `DmCallRing`, `DmCallAccept`, `DmCallReject`, `DmCallEnd` → dispatcht naar `useCallStore`.

Ring sound: `HTMLAudioElement` + Web Audio API fallback.

### `useDecryptedContent` (`hooks/useDecryptedContent.ts`)

Decrypts encrypted message content. Parameters: `content, nonce?, isDm?, channelId`.

Returns: `{displayContent, isEncrypted, decrypting}`.

- Decrypts via `decryptChannelMessage()` met shared symmetric channel key
- `nonce` aanwezig = encrypted, anders plaintext
- Fallback: `[Encrypted message — keys unavailable]` als decryptie faalt
- Retry: max 3x met 1s delay als E2EE keys nog niet geladen

### `usePresignRefresh` (`hooks/usePresignRefresh.ts`)

Refresht presigned S3 URLs elke 3 uur. Roept `fetchMessages`, `fetchServers`, `loadUser` aan.

### Pure UI hooks (geen backend)

- `useMobileNav` / `MobileNavProvider` — enige React Context in de app
- `useMobileView` — media query `max-width: 767px`
- `useKeyboardShortcuts` — Ctrl+K, Ctrl+Shift+M, Escape
- `useNMPlayer` — video player wrapper
- `useFocusTrap` — modal focus trap
- `useClickOutside` — click outside handler

---

## 11. App Initialisatie & Routing

### Bronbestand: `src/App.tsx`

### Provider Tree

```
<BrowserRouter basename="/app" | "/">
  <AppInit>                    ← lifecycle orchestrator
    <DeepLinkHandler />        ← jolkr:// URL handler (Tauri)
    <CallOverlays />           ← IncomingCallDialog + OutgoingCallDialog
    <TextContextMenu />
    <ContextMenu />
    <Routes>...</Routes>
  </AppInit>
</BrowserRouter>
```

Geen `QueryClientProvider`, geen Redux Provider, geen externe context providers behalve `MobileNavProvider` (in Layout).

### Initialisatie Sequence (AppInit useEffect)

```
1. initTokens()                    → tokens laden uit storage
2. loadUser()                      → GET /users/@me + wsClient.connect()
3. requestNotificationPermission() → browser Notification API
4. registerPush()                  → Web Push subscription
5. initE2EE(deviceId)              → key generatie + upload
6. initNotifications()             → WS message listener voor sounds
7. (Tauri) checkForUpdates()       → na 5s delay
```

### Routes

| Path | Component | Guard |
|------|-----------|-------|
| `/login` | `Login` | GuestGuard |
| `/register` | `Register` | GuestGuard |
| `/forgot-password` | `ForgotPassword` | GuestGuard |
| `/invite/:code` | `InviteAccept` | Geen |
| `/` | `Layout` → `Home` | AuthGuard |
| `/dm/:dmId` | `Layout` → `DmChat` | AuthGuard |
| `/friends` | `Layout` → `Friends` | AuthGuard |
| `/servers/:serverId` | `Layout` → `ServerPage` | AuthGuard |
| `/servers/:serverId/channels/:channelId` | `Layout` → `ChannelPage` | AuthGuard |
| `/settings` | `Layout` → `Settings` | AuthGuard |

### Guards

- `AuthGuard`: redirect naar `/login` als `user === null`
- `GuestGuard`: redirect naar `/` als `user !== null`

---

## 12. Data Types

### Bronbestand: `src/api/types.ts`

```typescript
interface User {
  id: string; username: string;
  display_name?: string | null; email?: string | null;
  avatar_url?: string | null; status?: string | null;
  bio?: string | null; is_online?: boolean;
  show_read_receipts?: boolean; is_system?: boolean;
  banner_color?: string | null;
  created_at?: string | null;
}

interface Server {
  id: string; name: string; description?: string | null;
  icon_url?: string | null; banner_url?: string | null;
  owner_id: string; is_public?: boolean;
  member_count?: number;
  theme?: { hue: number | null; orbs: { id: string; x: number; y: number; hue: number; scale?: number }[] } | null;
  created_at?: string | null;
}

interface Channel {
  id: string; server_id: string; name: string;
  kind: 'text' | 'voice' | 'category'; topic?: string | null;
  category_id?: string | null; position: number;
  is_nsfw?: boolean; is_system?: boolean;
  slowmode_seconds?: number;
  e2ee_key_generation?: number;
  created_at?: string | null;
}

interface Message {
  id: string; channel_id: string;
  author_id: string; content: string;
  nonce?: string | null;              // non-null = content is encrypted (base64 ciphertext)
  created_at: string; updated_at?: string | null;
  is_edited: boolean; is_pinned: boolean;
  reply_to_id?: string | null; thread_id?: string | null;
  thread_reply_count?: number | null;
  attachments: Attachment[]; reactions?: Reaction[];
  embeds?: MessageEmbed[]; poll?: Poll;
  webhook_id?: string | null;
  webhook_name?: string | null;
  webhook_avatar?: string | null;
  author?: User | null;
}

interface Attachment {
  id: string; filename: string;
  content_type: string; size_bytes: number; url: string;
}

interface MessageEmbed {
  url: string; title?: string | null; description?: string | null;
  image_url?: string | null; site_name?: string | null;
  color?: string | null;
}

interface Thread {
  id: string; channel_id: string;
  starter_msg_id?: string | null; name?: string | null;
  is_archived: boolean; message_count: number;
  created_at: string; updated_at: string;
}

interface Member {
  id: string; server_id: string; user_id: string;
  nickname?: string | null; joined_at: string;
  timeout_until?: string | null;
  user?: User; role_ids?: string[];
}

interface Role {
  id: string; server_id: string; name: string;
  color: number; position: number; permissions: number;
  is_default: boolean;
}

interface Category {
  id: string; server_id: string; name: string; position: number;
}

interface ChannelOverwrite {
  id: string; channel_id: string;
  target_type: 'role' | 'member'; target_id: string;
  allow: number; deny: number;
}

interface DmChannel {
  id: string; is_group: boolean; name?: string | null;
  members: string[];           // UUID array (not full User objects)
  created_at: string;
}

interface Friendship {
  id: string; requester_id: string; addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  requester?: User; addressee?: User;
}

interface Ban {
  id: string; server_id: string; user_id: string;
  banned_by?: string | null; reason?: string | null;
  created_at: string;
}

interface Invite {
  id: string; server_id: string; code: string;
  creator_id: string; max_uses?: number | null;
  use_count: number;
  expires_at?: string | null;
}

interface Webhook {
  id: string; channel_id: string; server_id: string;
  creator_id: string; name: string;
  avatar_url?: string | null; token?: string;
}

interface Poll {
  id: string; message_id: string; channel_id: string;
  question: string; multi_select: boolean; anonymous: boolean;
  expires_at?: string | null;
  options: PollOption[];
  votes: Record<string, number>;  // option_id → count
  my_votes?: string[];             // option_ids I voted for
  total_votes: number;
}

interface PollOption {
  id: string; poll_id: string; position: number; text: string;
}

interface ServerEmoji {
  id: string; server_id: string; name: string;
  image_url: string; uploader_id: string; animated: boolean;
}

interface NotificationSetting {
  target_type: 'server' | 'channel'; target_id: string;
  muted: boolean; mute_until?: string | null;
  suppress_everyone: boolean;
}

interface AuditLogEntry {
  id: string; server_id: string; user_id: string;
  action_type: string; target_id?: string | null;
  target_type?: string | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null; created_at: string;
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

interface PreKeyBundleResponse {
  user_id: string; device_id: string;
  identity_key: string;
  signed_prekey: string;
  signed_prekey_signature: string;
  one_time_prekey?: string | null;
  pq_signed_prekey?: string | null;
  pq_signed_prekey_signature?: string | null;
}

interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
  user_ids?: string[];
}
```

---

## 13. Feature Flags & Platform Detectie

| Check | Hoe | Effect |
|-------|-----|--------|
| `isTauri` | `window.__TAURI_INTERNALS__` | Stronghold, deep links, updater, absolute URLs, geen push |
| `VITE_DEV_MODE` | build-time env | Tauri server-selectiescherm |
| `TAURI_ENV_PLATFORM` | build-time | Mobile vs desktop; Stronghold uit op Android/iOS |

### localStorage Preferences

| Key | Waarden | Default |
|-----|---------|---------|
| `jolkr_theme` | `dark` / `light` | dark |
| `jolkr_sound` | `true` / `false` | true |
| `jolkr_desktop_notif` | `true` / `false` | true |
| `jolkr_ringtone` | `classic` / `tone` | classic |
| `jolkr_server_url` | URL string | — (Tauri dev only) |
| `jolkr_logged_out` | `true` | — (set on logout) |
| `jolkr_push_device_id` | UUID | — |
| `jolkr_e2ee_device_id` | UUID | — |
| `jolkr_last_seen` | JSON `Record<channelId, messageId>` | — |

---

## 14. Migratiechecklist

### Must-have (app werkt niet zonder)

- [ ] **API Client**: `fetch()` wrapper met Bearer token, auto-refresh op 401, retry queue
- [ ] **Token Storage**: opslaan/laden van access + refresh token (kies platform-specifiek)
- [ ] **Auth Flow**: login → setTokens → getMe → WS connect → E2EE init
- [ ] **WebSocket Client**: connect, identify, heartbeat (30s), reconnect (exp backoff, max 10x)
- [ ] **WS Event Handlers**: alle 25+ server→client events registreren
- [ ] **Channel Subscriptions**: refcount-based subscribe/unsubscribe + re-subscribe op reconnect
- [ ] **URL Config**: platform-aware URL resolutie (relative vs absolute)

### Must-have (features werken niet zonder)

- [ ] **E2EE Key Generatie**: PBKDF2 seed → HKDF key derivation → upload
- [ ] **DM Encryptie**: X25519 + ML-KEM-768 hybrid (v0x03 only — legacy verwijderd)
- [ ] **Channel Key Management**: shared symmetric key distribute/fetch/cache
- [ ] **Message Decryption Hook**: `useDecryptedContent` — nonce-based detection, channel-key decrypt
- [ ] **Voice WS + WebRTC**: separate signaling WS, SDP offer/answer, ICE
- [ ] **Voice E2EE**: Web Worker frame encryption
- [ ] **Push Registration**: service worker + VAPID subscription
- [ ] **DM Call Signaling**: REST endpoints + WS events

### Nice-to-have (UX features)

- [ ] **Typing Indicators**: TypingStart send (3s throttle) + receive (5s TTL via `useTypingStore`)
- [ ] **Presence Updates**: send/receive online status
- [ ] **Unread Counts**: WS-driven met localStorage persistence
- [ ] **Read Receipts**: DmMessagesRead + ChannelMessagesRead + ServerMessagesRead events
- [ ] **Notification Sound**: Web Audio API beep
- [ ] **Desktop Notifications**: Notification API
- [ ] **Presign Refresh**: S3 URL refresh elke 3 uur
- [ ] **Deep Links**: jolkr:// URL scheme (Tauri only)
- [ ] **Auto Updater**: Tauri plugin (desktop only)

### Bestanden om 1:1 over te nemen

Deze bestanden zijn framework-onafhankelijk en kunnen (bijna) letterlijk gekopieerd worden:

1. `src/api/client.ts` — volledige REST API surface
2. `src/api/ws.ts` — WebSocket gateway client
3. `src/api/types.ts` — alle TypeScript interfaces
4. `src/crypto/keys.ts` — key generation primitives
5. `src/crypto/e2ee.ts` — encrypt/decrypt logica
6. `src/crypto/channelKeys.ts` — channel key management
7. `src/crypto/keyStore.ts` — key persistence
8. `src/voice/voiceClient.ts` — voice WS protocol
9. `src/voice/voiceService.ts` — WebRTC orchestratie
10. `src/voice/encryptionWorker.ts` — audio frame E2EE worker
11. `src/platform/config.ts` — URL resolutie
12. `src/platform/storage.ts` — storage abstractie
13. `src/services/e2ee.ts` — E2EE service layer
14. `src/services/pushRegistration.ts` — push subscription
15. `src/services/notifications.ts` — notification sounds

### Zustand → nieuwe state library mapping

| Huidige Store | State | Backend Koppeling |
|---------------|-------|-------------------|
| `useAuthStore` | user, loading, error | REST + WS (UserUpdate) |
| `useServersStore` | servers, channels, members, roles, categories, permissions, emojis | REST + WS (6 events) |
| `useMessagesStore` | messages (LRU 30), threads | REST + WS (7 events) |
| `usePresenceStore` | presence | WS only (PresenceUpdate) |
| `useTypingStore` | typing per channel | WS only (TypingStart, 5s TTL) |
| `useVoiceStore` | voice state | Voice WS + WebRTC |
| `useCallStore` | call state | REST (4 endpoints) + WS (4 events) |
| `useUnreadStore` | counts, activeChannel, lastSeen | WS (4 events: MessageCreate, DmMessagesRead, ChannelMessagesRead, ServerMessagesRead) + localStorage |
| `useDmReadsStore` | readStates | WS (1 event) |

---

> **Bijgewerkt op 2026-04-08** — versie 0.10.0, gebaseerd op de huidige staat van `jolkr-app/src/` en `jolkr-server/` (inclusief migraties t/m 033).
