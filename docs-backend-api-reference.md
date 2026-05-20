# Jolkr Backend API Reference

> **Version**: 0.11.3 (workspace + frontend)
>
> Complete reference for building any client (web, Tauri desktop, mobile, bot) against the Jolkr backend. Every route, WebSocket event, environment variable, DB table, and architectural rule below is verified against the current code in `jolkr-server/`. **Source of truth: code, not this file** — but if the two diverge, fix the code or fix this file in the same PR.
>
> Auth conventions: every endpoint marked **JWT** expects `Authorization: Bearer <access_token>`. Endpoints marked **None** are public. Endpoints marked **Admin** require both a JWT and the `X-Admin-Secret` header equal to `ADMIN_SECRET`.

---

## Table of Contents

1. [General](#1-general)
2. [Authentication](#2-authentication)
3. [Users](#3-users)
4. [Friends](#4-friends)
5. [Direct Messages (DMs)](#5-direct-messages-dms)
6. [Servers](#6-servers)
7. [Server Moderation & Bans](#7-server-moderation--bans)
8. [Categories](#8-categories)
9. [Roles & Permissions](#9-roles--permissions)
10. [Channels](#10-channels)
11. [Channel Permission Overwrites](#11-channel-permission-overwrites)
12. [Messages](#12-messages)
13. [Threads](#13-threads)
14. [Reactions](#14-reactions)
15. [Pins](#15-pins)
16. [Polls](#16-polls)
17. [Webhooks](#17-webhooks)
18. [Custom Server Emojis](#18-custom-server-emojis)
19. [Invites](#19-invites)
20. [Audit Log](#20-audit-log)
21. [Notification Settings](#21-notification-settings)
22. [Presence & Status](#22-presence--status)
23. [E2EE — DM Prekeys (X3DH + PQ)](#23-e2ee--dm-prekeys-x3dh--pq)
24. [E2EE — Channel & DM Sender Keys](#24-e2ee--channel--dm-sender-keys)
25. [Devices & Push Notifications](#25-devices--push-notifications)
26. [File Uploads & Attachments](#26-file-uploads--attachments)
27. [GIFs & oEmbed](#27-gifs--oembed)
28. [Public Image Endpoints](#28-public-image-endpoints)
29. [Health & Metrics](#29-health--metrics)
30. [WebSocket Gateway (`/ws`)](#30-websocket-gateway-ws)
31. [Voice WebSocket (`/media/ws/voice`)](#31-voice-websocket-mediawsvoice)
32. [Environment Variables](#32-environment-variables)
33. [Database Tables](#33-database-tables)
34. [Rate Limiting](#34-rate-limiting)
35. [Error Responses](#35-error-responses)
36. [Security Architecture (selected hardening)](#36-security-architecture-selected-hardening)
37. [Infrastructure Stack](#37-infrastructure-stack)

---

## 1. General

| Property | Value |
|----------|-------|
| Base URL (local dev) | `http://localhost:8080` (override via `SERVER_PORT`) |
| Base URL (prod) | `https://jolkr.app` (Cloudflare → nginx → Axum) |
| Upload bypass URL | `https://upload.jolkr.app` — DNS-only A-record, **not** Cloudflare-proxied. Accepts only the two attachment endpoints (§26.3); all other paths return 404. |
| WebSocket gateway | `wss://jolkr.app/ws` (chat/control plane) |
| Voice WebSocket | `wss://jolkr.app/media/ws/voice` (SFU signalling) |
| Content-Type | `application/json` unless explicitly multipart |
| Body limit | 260 MB total (Axum `DefaultBodyLimit`) — matches `MAX_FILE_SIZE = 250 MB` + multipart overhead |
| Request timeout | 30 s for all HTTP routes (WebSockets and `/health` are excluded) |
| ID format | UUID v4 everywhere |
| Timestamps | RFC 3339 / ISO 8601 in UTC |
| Request ID | `X-Request-Id` propagated through the stack (auto-generated if missing) |

### CORS

`CORS_ORIGINS` (comma-separated full origins). Empty falls back to:
`http://localhost:1420, http://localhost, https://tauri.localhost`. Allowed methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`. Allowed headers: `authorization, content-type, accept`.

### Auth header

```
Authorization: Bearer <jwt>
```

### E2EE on the wire

The `encrypted_content` column was removed in migration 032. Encrypted messages now travel in the regular `content` field as **base64-encoded ciphertext**, and the message is identified as encrypted by a non-null `nonce` (also base64). Plaintext messages have `nonce: null`.

---

## 2. Authentication

Routes: `jolkr-api/src/routes/auth.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | None | Create account, return tokens + self-profile |
| POST | `/api/auth/login` | None | Email + password login |
| POST | `/api/auth/refresh` | None (bearer not required; uses body) | Rotate access token |
| POST | `/api/auth/forgot-password` | None | Request password-reset email (always 200) |
| POST | `/api/auth/reset-password-confirm` | None | Consume reset token, set new password |
| POST | `/api/auth/verify-email` | None | Consume email-verification token |
| POST | `/api/auth/reset-password` | **Admin** | Admin override password reset |
| POST | `/api/auth/change-password` | JWT | Change own password |
| POST | `/api/auth/logout` | JWT | Revoke this session's refresh token + blacklist jti |
| POST | `/api/auth/logout-all` | JWT | Revoke every session for the user |
| POST | `/api/auth/resend-verification` | JWT | Resend verification email |

### POST `/api/auth/register`

```jsonc
// Request
{ "email": "user@example.com", "username": "johndoe", "password": "SecurePass123!" }

// Response 200
{
  "user": { /* full self-profile, see §3 */ },
  "tokens": { "access_token": "eyJ...", "refresh_token": "eyJ...", "expires_in": 86400 }
}
```

### POST `/api/auth/login`

```jsonc
{ "email": "user@example.com", "password": "SecurePass123!" }
// → same shape as register
```

### POST `/api/auth/refresh`

```jsonc
{ "refresh_token": "eyJ..." }
// → { "tokens": { "access_token": "...", "refresh_token": "...", "expires_in": 86400 } }
```

### JWT details

- **Algorithm**: HS256 (`HMAC-SHA256`)
- **Claims**: `{ sub: user_id, iat, exp, device_id?: Uuid, jti: String }`
- **Access token** lifetime: ~24h by default (override via `ACCESS_TOKEN_EXPIRY`); the FE force-refreshes inside the last 30 min and on any 401.
- **Refresh token**: stored bcrypt-hashed in `sessions`. On rotation the row is replaced.
- **Blacklist**: every successful logout writes `blacklist:{jti}` to Redis (TTL ≈ access-token lifetime). Both the HTTP auth middleware and the WS gateway/voice WS check this set and fail **closed** if Redis is unreachable.
- **Force-logout floor (SEC-011, migration 040)**: the env var `JWT_MIN_ISSUED_AT` (unix seconds) rejects any access token whose `iat` is earlier than the floor. The same migration truncates `sessions`, forcing every user through login on next refresh.

### Failed-login lockout

5 failures within ~15 minutes locks the email out for 15 minutes (tracked in Redis under the auth route).

---

## 3. Users

Routes: `users.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/@me` | JWT | Self-profile |
| PATCH | `/api/users/@me` | JWT | Update self |
| GET | `/api/users/:id` | JWT | Public profile by ID |
| POST | `/api/users/batch` | JWT | Bulk fetch (max 100 IDs) |
| GET | `/api/users/search?q=` | JWT | Exact-match search on username (min 3 chars, max 3 results) |

### Self-profile (`MeProfile`)

```jsonc
{
  "id": "uuid",
  "email": "user@example.com",
  "email_verified": true,
  "username": "johndoe",
  "display_name": "John Doe",
  "avatar_url": "https://...",
  "status": "online",
  "bio": "Hello world",
  "banner_color": "#7c3aed",
  "show_read_receipts": true,
  "dm_filter": "all",            // "all" | "friends" | "none"
  "allow_friend_requests": true,
  "preferred_language": "en-US", // BCP-47 lite, NULL falls back to FE default
  "created_at": "2026-01-01T00:00:00Z"
}
```

### Public profile (`User`)

Same shape as `MeProfile` **minus** `email`, `email_verified`, `dm_filter`, `allow_friend_requests`, `preferred_language` (those are self-only).

### PATCH `/api/users/@me`

All fields optional:

```jsonc
{
  "display_name": "New Name",
  "avatar_url": "https://...",
  "status": "online",
  "bio": "Updated bio",
  "banner_color": "#7c3aed",
  "show_read_receipts": false,
  "dm_filter": "friends",
  "allow_friend_requests": true,
  "preferred_language": "nl"
}
```

- `dm_filter`: `"all"` lets anyone open a DM; `"friends"` requires mutual friend or shared server; `"none"` rejects new DMs entirely (existing DMs keep working).
- `allow_friend_requests: false` makes `POST /api/friends` fail when the requester has no mutual server/DM.
- `preferred_language` accepts the BCP-47 lite pattern `^[a-z]{2}(-[A-Z]{2})?$`; the API layer additionally enforces a whitelist (`en-US, nl, fr, de, es, it, ja, ko, zh-CN`).

### POST `/api/users/batch`

```jsonc
{ "ids": ["uuid1", "uuid2", "..." ] }   // max 100
// → { "users": [User, ...] }
```

---

## 4. Friends

Routes: `friends.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/friends` | JWT | List accepted friends (both directions) |
| GET | `/api/friends/pending` | JWT | List pending (incoming + outgoing) |
| POST | `/api/friends` | JWT | Send friend request |
| POST | `/api/friends/:id/accept` | JWT | Accept incoming request |
| DELETE | `/api/friends/:id` | JWT | Decline / unfriend |
| POST | `/api/friends/block` | JWT | Block a user (replaces any prior friendship row) |

`status` is a CHECK-constrained enum: `pending | accepted | blocked`.

```jsonc
// POST /api/friends
{ "user_id": "uuid" }
// → { "friendship": {
//      "id": "uuid", "requester_id": "...", "addressee_id": "...",
//      "status": "pending", "created_at": "...", "updated_at": "..." } }
```

WS fan-out: `FriendshipUpdate { friendship, kind }`, `kind` ∈ `created | accepted | declined | removed | blocked`. Sent to both parties.

---

## 5. Direct Messages (DMs)

Routes: `routes/dms/*`.

### 5.1 DM channels

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dms` | JWT | List visible DM channels (closed DMs hidden) |
| POST | `/api/dms` | JWT | Open 1-on-1 or create group DM |
| PATCH | `/api/dms/:dm_id` | JWT | Rename a group DM (`name: null` clears) |
| PUT | `/api/dms/:dm_id/members` | JWT | Add member to group DM |
| DELETE | `/api/dms/:dm_id/members/@me` | JWT | Leave DM |
| POST | `/api/dms/:dm_id/close` | JWT | Hide DM for self only (soft) |

```jsonc
// 1-on-1: { "user_id": "uuid" }
// Group : { "user_ids": ["uuid1", "uuid2"], "name": "Optional group name" }
```

`POST .../close` hides the DM until a new message arrives. WS fan-out: emits `DmClose { dm_id }` to the closer's own sessions; other members get a `DmUpdate` (their participant view is unchanged).

### 5.2 DM messages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dms/:dm_id/messages?limit=&before=` | JWT | Paginated history |
| POST | `/api/dms/:dm_id/messages` | JWT | Send message |
| PATCH | `/api/dms/messages/:id` | JWT | Edit (author only) |
| DELETE | `/api/dms/messages/:id` | JWT | Delete for everyone (author only) |
| POST | `/api/dms/messages/:id/hide` | JWT | Soft-delete for self only |

`POST /api/dms/messages/:id/hide` emits `DmMessageHide { dm_id, message_id }` **only to the hider's other sessions**; nobody else sees the change.

```jsonc
// Plaintext
{ "content": "Hello!", "reply_to_id": "uuid?" }
// Encrypted
{ "content": "<base64-ciphertext>", "nonce": "<base64-nonce>", "reply_to_id": "uuid?" }
```

### 5.3 DM reactions / pins / read state / attachments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dms/messages/:id/reactions` | JWT | List raw reaction rows |
| POST | `/api/dms/messages/:id/reactions` | JWT | Add `{ "emoji": "🔥" }` |
| DELETE | `/api/dms/messages/:id/reactions/:emoji` | JWT | Remove my reaction (URL-encoded emoji) |
| GET | `/api/dms/:dm_id/pins` | JWT | List pinned DM messages |
| POST | `/api/dms/:dm_id/pins/:message_id` | JWT | Pin |
| DELETE | `/api/dms/:dm_id/pins/:message_id` | JWT | Unpin |
| POST | `/api/dms/:dm_id/read` | JWT | `{ "message_id": "uuid" }` — broadcasts `DmMessagesRead` |
| POST | `/api/dms/:dm_id/messages/:message_id/attachments` | JWT | Multipart upload (route also reachable via `upload.jolkr.app`) |
| GET | `/api/dms/:dm_id/attachments` | JWT | Gallery view: every attachment ever shared in the DM |

### 5.4 DM calls

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/dms/:dm_id/call?is_video=<bool>` | JWT | Ring the other party (`is_video=true` for video) |
| POST | `/api/dms/:dm_id/call/accept` | JWT | Accept |
| POST | `/api/dms/:dm_id/call/reject` | JWT | Reject |
| POST | `/api/dms/:dm_id/call/end` | JWT | Hang up |

`is_video` is propagated through `DmCallRing { dm_id, caller_id, caller_username, is_video }` so the recipient UI can choose ringtone/video preview. Call participation across the user's own sessions is mirrored via `UserCallPresence` (§30).

### 5.5 DM E2EE distribution

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/dms/:dm_id/e2ee/distribute` | JWT | Push per-recipient encrypted sender keys |
| GET | `/api/dms/:dm_id/e2ee/my-key` | JWT | Fetch own encrypted key for this DM |

Shapes are identical to channel sender keys (§24).

---

## 6. Servers

Routes: `servers.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers` | JWT | List user's servers (sorted by stored position) |
| POST | `/api/servers` | JWT | Create server |
| GET | `/api/servers/discover?limit=&offset=` | JWT | Discover public servers |
| GET | `/api/servers/:id` | JWT | Get server |
| PATCH | `/api/servers/:id` | JWT | Update server (owner / MANAGE_SERVER) |
| DELETE | `/api/servers/:id` | JWT | Delete (owner only) |
| POST | `/api/servers/:id/join` | JWT | Join a public server (bans enforced) |
| PUT | `/api/users/@me/servers/reorder` | JWT | Reorder personal server list |

### POST `/api/servers`

```jsonc
{ "name": "My Server", "description": "Optional" }
// → { "server": ServerInfo }
```

### `ServerInfo`

```jsonc
{
  "id": "uuid",
  "name": "...",
  "description": "...",
  "icon_url": "https://... | null",
  "banner_url": "https://... | null",
  "owner_id": "uuid",
  "is_public": false,
  "member_count": 1,
  "theme": { "hue": 280, "orbs": [{ "id": "...", "x": 0.5, "y": 0.5, "hue": 280, "scale": 1.2 }] }
}
```

`theme` is stored as JSONB and is forward-compatible. The frontend layers the typed `ServerThemeData` interface on top.

### PATCH `/api/servers/:id`

All fields optional:

```jsonc
{
  "name": "...",
  "description": "...",
  "icon_url": "https://... | null",
  "banner_url": "https://... | null",
  "is_public": true,
  "theme": { "hue": 280, "orbs": [...] }
}
```

### Discovery

```jsonc
// GET /api/servers/discover?limit=20&offset=0
{ "servers": [ServerInfo, ...], "total": 42 }
```

### Reorder

```jsonc
// PUT /api/users/@me/servers/reorder
{ "server_ids": ["uuid-1", "uuid-2", "..."] }   // index = position
```

---

## 7. Server Moderation & Bans

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:id/members` | JWT | Paginated member list (`?limit=&offset=`) |
| GET | `/api/servers/:id/members-with-roles` | JWT | Members with their role IDs |
| DELETE | `/api/servers/:id/members/@me` | JWT | Leave server |
| DELETE | `/api/servers/:id/members/:user_id` | JWT | Kick (KICK_MEMBERS) |
| PATCH | `/api/servers/:id/members/:user_id/nickname` | JWT | `{ "nickname": "Nick" }` or `{ "nickname": null }` |
| POST | `/api/servers/:id/members/:user_id/timeout` | JWT | `{ "timeout_until": "RFC3339" }` ≤ 28d in the future |
| DELETE | `/api/servers/:id/members/:user_id/timeout` | JWT | Clear timeout |
| POST | `/api/servers/:id/read-all` | JWT | Mark every channel read; broadcasts `ServerMessagesRead` |
| GET | `/api/servers/:id/bans` | JWT | List bans |
| POST | `/api/servers/:id/bans` | JWT | `{ "user_id": "uuid", "reason": "..." }` |
| DELETE | `/api/servers/:id/bans/:user_id` | JWT | Unban |

WS fan-out for member changes: `MemberUpdate { server_id, user_id, timeout_until?, nickname?, role_ids? }`. Only the keys that actually changed are present. `nickname: ""` clears the nickname client-side.

When a user is kicked/banned, the gateway also drops their channel subscriptions for that server (F06 hardening).

---

## 8. Categories

Routes: `categories.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/categories` | JWT | List categories (sorted by position) |
| POST | `/api/servers/:server_id/categories` | JWT | `{ "name": "Voice" }` |
| PATCH | `/api/categories/:id` | JWT | `{ "name"?: "...", "position"?: 0 }` |
| DELETE | `/api/categories/:id` | JWT | Delete (channels reparent to NULL) |
| PUT | `/api/servers/:server_id/categories/reorder` | JWT | `{ "category_positions": [{ "id": "...", "position": 0 }] }` |

WS: `CategoryCreate | CategoryUpdate | CategoryDelete`.

---

## 9. Roles & Permissions

Routes: `roles.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/roles` | JWT | List roles (position ASC) |
| POST | `/api/servers/:server_id/roles` | JWT | Create role |
| PATCH | `/api/roles/:id` | JWT | Update |
| DELETE | `/api/roles/:id` | JWT | Delete |
| PUT | `/api/servers/:server_id/roles/:role_id/members` | JWT | Assign role (`{ "user_id": "..." }`) |
| DELETE | `/api/servers/:server_id/roles/:role_id/members/:user_id` | JWT | Unassign |
| GET | `/api/servers/:server_id/members-with-roles` | JWT | Members + their role IDs (same as §7) |
| GET | `/api/servers/:server_id/permissions/@me` | JWT | `{ "permissions": <i64 bitfield> }` |

### `Role`

```jsonc
{
  "id": "uuid",
  "server_id": "uuid",
  "name": "Moderator",
  "color": 3447003,
  "position": 1,
  "permissions": 1099511627775,
  "is_default": false
}
```

### Permission bitfield (`Permissions` in `jolkr-common`)

Stored as `BIGINT` (signed 64-bit, used as bitmask). Current bits:

| Bit | Value | Name | Description |
|-----|-------|------|-------------|
| 0 | 1 | `VIEW_CHANNELS` | See channels |
| 1 | 2 | `SEND_MESSAGES` | Send in text channels |
| 2 | 4 | `MANAGE_MESSAGES` | Delete/pin others' messages |
| 3 | 8 | `MANAGE_CHANNELS` | Create/edit/delete channels |
| 4 | 16 | `MANAGE_SERVER` | Edit server settings |
| 5 | 32 | `MANAGE_ROLES` | Create/edit/delete roles |
| 6 | 64 | `KICK_MEMBERS` | Kick |
| 7 | 128 | `BAN_MEMBERS` | Ban/unban |
| 8 | 256 | `CREATE_INVITES` | Create invites |
| 9 | 512 | `MANAGE_WEBHOOKS` | Webhook CRUD |
| 10 | 1024 | `MANAGE_EMOJIS` | Upload/delete server emojis |
| 11 | 2048 | `MANAGE_THREADS` | Manage threads |
| 12 | 4096 | `ADMINISTRATOR` | Grants everything |

Permission computation: start with `@everyone` (the `is_default` role), OR in every assigned role's permissions, then apply channel overwrites (`allow` adds bits, `deny` removes). If `ADMINISTRATOR` is set or the user is the server owner → all permissions.

`RoleUpdate` fan-out warns clients to re-fetch their channel permissions.

---

## 10. Channels

Routes: `channels.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/channels/list` | JWT | List channels for a server |
| POST | `/api/servers/:server_id/channels` | JWT | Create channel |
| PATCH | `/api/channels/:id` | JWT | Update channel (see body below) |
| DELETE | `/api/channels/:id` | JWT | Delete channel |
| GET | `/api/channels/:id` | JWT | Get channel |
| PUT | `/api/servers/:server_id/channels/reorder` | JWT | Reorder within current categories |
| PUT | `/api/servers/:server_id/channels/move` | JWT | Reorder **and/or** re-parent to another category |
| GET | `/api/channels/:id/members` | JWT | Members who can `VIEW_CHANNELS` after overwrites |

### Channel kinds

`"text"` or `"voice"`. (`"category"` exists in the FE union for legacy code paths but is not a stored channel kind.)

### POST `/api/servers/:server_id/channels`

```jsonc
{ "name": "general", "kind": "text", "category_id": "uuid-or-null" }
```

`topic`, `is_nsfw`, `slowmode_seconds` are set via PATCH after creation.

### PATCH `/api/channels/:id`

```jsonc
{
  "name": "...",
  "topic": "string | null",
  "category_id": "uuid | null",   // double-Option semantics: absent = keep, null = uncategorize, uuid = move
  "is_nsfw": true,
  "slowmode_seconds": 5
}
```

### Reorder vs Move

- **`PUT .../channels/reorder`** — for in-category sort changes only.
  ```jsonc
  { "channel_positions": [{ "id": "...", "position": 0 }] }
  ```
- **`PUT .../channels/move`** — single endpoint to reposition AND re-parent.
  ```jsonc
  {
    "items": [
      { "id": "uuid", "position": 0, "category_id": "uuid" },   // move under category
      { "id": "uuid", "position": 1, "category_id": null }      // explicit uncategorize
      // omit `category_id` to keep the current parent
    ]
  }
  ```
  Returns the full updated channel list. Emits one `ChannelUpdate` per affected channel.

### `ChannelInfo` response

```jsonc
{
  "channel": {
    "id": "uuid",
    "server_id": "uuid",
    "category_id": "uuid | null",
    "name": "general",
    "topic": "...",
    "kind": "text",
    "position": 0,
    "is_nsfw": false,
    "slowmode_seconds": 0,
    "e2ee_key_generation": 0
  }
}
```

---

## 11. Channel Permission Overwrites

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:id/permissions/@me` | JWT | My effective bitfield for this channel |
| GET | `/api/channels/:id/overwrites` | JWT | List overwrites |
| PUT | `/api/channels/:id/overwrites` | JWT | Upsert overwrite |
| DELETE | `/api/channels/:id/overwrites/:target_type/:target_id` | JWT | Remove overwrite |

```jsonc
// PUT body
{ "target_type": "role" | "member", "target_id": "uuid", "allow": 1024, "deny": 0 }
```

WS fan-out: `ChannelPermissionUpdate { channel_id, server_id, overwrites }` carries the **full** updated overwrite list — clients can replace their cache wholesale.

---

## 12. Messages

Routes: `messages.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:id/messages?limit=&before=` | JWT | Paginated history (default `limit=50`) |
| POST | `/api/channels/:id/messages` | JWT | Send message |
| PATCH | `/api/messages/:id` | JWT | Edit (author only, or MANAGE_MESSAGES + own) |
| DELETE | `/api/messages/:id` | JWT | Delete (author or MANAGE_MESSAGES) |
| GET | `/api/channels/:id/messages/search?q=&from=&has=&before=&after=&limit=` | JWT | Server-side search + filter |

### POST body

```jsonc
{ "content": "Hello", "nonce": null, "reply_to_id": "uuid?" }
// encrypted: { "content": "<base64 ct>", "nonce": "<base64 nonce>" }
```

### `Message` response

```jsonc
{
  "message": {
    "id": "uuid",
    "channel_id": "uuid",
    "author_id": "uuid",
    "content": "Hello!",
    "nonce": null,
    "is_edited": false,
    "is_pinned": false,
    "reply_to_id": null,
    "thread_id": null,
    "thread_reply_count": null,
    "webhook_id": null,
    "webhook_name": null,
    "webhook_avatar": null,
    "attachments": [Attachment, ...],
    "reactions": [Reaction, ...],
    "embeds": [MessageEmbed, ...],
    "poll": null,
    "created_at": "2026-04-01T00:00:00Z",
    "updated_at": "2026-04-01T00:00:00Z"
  }
}
```

### Search

`q`, `from` (username), `has` (`image | video | audio | file`), `before`, `after` (RFC3339), `limit`. Response: `{ messages: [...], total: <int> }`.

---

## 13. Threads

Routes: `threads.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:channel_id/threads?include_archived=<bool>` | JWT | List threads |
| POST | `/api/channels/:channel_id/threads` | JWT | Create thread from a starter message |
| GET | `/api/threads/:thread_id` | JWT | Get thread |
| PATCH | `/api/threads/:thread_id` | JWT | Update (`name`, `is_archived`) |
| GET | `/api/threads/:thread_id/messages?limit=&before=` | JWT | List thread messages |
| POST | `/api/threads/:thread_id/messages` | JWT | Post in thread (same shape as `/api/channels/:id/messages`) |

```jsonc
// POST /api/channels/:channel_id/threads
{ "message_id": "uuid-starter", "name": "Optional name" }
// → { "thread": Thread, "message": Message }
```

`Thread` shape: `{ id, channel_id, starter_msg_id, name, is_archived, message_count, created_at, updated_at }`.

---

## 14. Reactions

Routes: `reactions.rs` (channels) + `dms/reactions.rs` (DMs).

### Channel reactions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/messages/:id/reactions` | JWT | `{ "emoji": "🔥" }` |
| GET | `/api/messages/:id/reactions` | JWT | Raw reaction rows (client aggregates) |
| DELETE | `/api/messages/:message_id/reactions/:emoji` | JWT | Remove own reaction (URL-encoded emoji) |

```jsonc
// GET response — raw rows
{
  "reactions": [
    { "id": "uuid", "message_id": "uuid", "user_id": "uuid", "emoji": "🔥", "created_at": "..." }
  ]
}
```

WS fan-out: `ReactionUpdate { channel_id, message_id, reactions }` with the per-emoji aggregated `[{ emoji, count, user_ids: [...] }]` shape.

DM reactions use the same shapes at `/api/dms/messages/:id/reactions[/...]` (§5.3).

---

## 15. Pins

### Channel pins

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:channel_id/pins` | JWT | List pinned messages |
| POST | `/api/channels/:channel_id/pins/:message_id` | JWT | Pin |
| DELETE | `/api/channels/:channel_id/pins/:message_id` | JWT | Unpin |

DM pins: identical pattern under `/api/dms/:dm_id/pins[/...]` (§5.3).

---

## 16. Polls

Routes: `polls.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/channels/:id/polls` | JWT | Create poll (attaches a poll-typed message to the channel) |
| GET | `/api/polls/:id` | JWT | Get poll state |
| POST | `/api/polls/:id/vote` | JWT | `{ "option_id": "uuid" }` |
| DELETE | `/api/polls/:id/vote` | JWT | `{ "option_id": "uuid" }` to clear that specific vote |

```jsonc
// Create
{
  "question": "What should we build next?",
  "options": ["A", "B", "C"],
  "multi_select": false,
  "anonymous": false,
  "expires_at": "2026-04-08T12:00:00Z"   // optional
}

// Response 200 — wraps both the poll AND the message that holds it
{
  "poll": { "id": "...", "message_id": "...", "channel_id": "...", "question": "...",
            "multi_select": false, "anonymous": false, "expires_at": "...",
            "options": [{ "id": "...", "text": "A", "position": 0 }, ...],
            "votes": {}, "my_votes": [], "total_votes": 0, "created_at": "..." },
  "message": { Message }
}
```

WS fan-out on vote changes: `PollUpdate { poll, channel_id, message_id }` carries the full poll snapshot.

---

## 17. Webhooks

Routes: `webhooks.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:id/webhooks` | JWT | List webhooks in a channel |
| POST | `/api/channels/:id/webhooks` | JWT | Create — **plaintext token returned only here** |
| PATCH | `/api/webhooks/:id` | JWT | Rename / change avatar |
| DELETE | `/api/webhooks/:id` | JWT | Delete |
| POST | `/api/webhooks/:id/token` | JWT | Rotate token — returns new plaintext token |
| POST | `/api/webhooks/:id/:token` | **None** | Execute webhook to send a message |

```jsonc
// Create
{ "name": "GitHub Bot", "avatar_url": "https://..." }
// → { "webhook": { "id": "...", "name": "...", "avatar_url": "...", "token": "PLAINTEXT" } }

// Execute (no auth — token is the credential)
{ "content": "New commit", "username": "Optional override", "avatar_url": "https://..." }
```

Token storage: SHA-256 hash in `webhooks.token_hash`. Execution rate-limited at burst 20 / refill 10 per second per webhook via Redis (fail-closed if Redis is down).

---

## 18. Custom Server Emojis

Routes: `emojis.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/emojis` | JWT | List server emojis |
| POST | `/api/servers/:server_id/emojis` | JWT | Multipart upload (`name`, `file`) — requires `MANAGE_EMOJIS` |
| DELETE | `/api/emojis/:emoji_id` | JWT | Delete |

```jsonc
{
  "emoji": {
    "id": "uuid",
    "server_id": "uuid",
    "name": "pepe_happy",
    "image_url": "https://...",
    "uploader_id": "uuid",
    "animated": false
  }
}
```

---

## 19. Invites

Routes: `invites.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/invites` | JWT | List invites |
| POST | `/api/servers/:server_id/invites` | JWT | Create (`max_uses?`, `max_age_seconds?`) |
| DELETE | `/api/servers/:server_id/invites/:invite_id` | JWT | Revoke |
| POST | `/api/invites/:code` | JWT | Consume invite |

```jsonc
{ "invite": {
  "id": "uuid", "server_id": "uuid", "creator_id": "uuid",
  "code": "abc123XYZ", "max_uses": 10, "use_count": 0,
  "expires_at": "2026-04-01T00:00:00Z"
} }
```

---

## 20. Audit Log

Routes: `audit_log.rs`. Requires server owner or `MANAGE_SERVER`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/audit-log?action=&limit=&before=` | JWT | Paginated entries |

```jsonc
{
  "entries": [
    {
      "id": "uuid",
      "server_id": "uuid",
      "user_id": "uuid",
      "action_type": "member_kick",
      "target_id": "uuid | null",
      "target_type": "member | role | channel | ...",
      "changes": { "...": "JSONB diff" },
      "reason": "Violated rules",
      "created_at": "..."
    }
  ]
}
```

Page backwards by passing `before=<id>`. Indexed on `(server_id, created_at DESC)` after migration 033.

---

## 21. Notification Settings

Routes: `notifications.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/me/notifications` | JWT | List own per-target settings |
| GET | `/api/users/me/notifications/:target_type/:target_id` | JWT | Get one |
| PUT | `/api/users/me/notifications/:target_type/:target_id` | JWT | Upsert (or delete to restore defaults) |

`target_type ∈ { "server", "channel" }`.

```jsonc
// PUT body
{ "muted": true, "mute_until": "2026-04-01T00:00:00Z", "suppress_everyone": true }
```

WS fan-out: `NotificationSettingUpdate { target_type, target_id, setting? }`. `setting: null` ⇒ row deleted (defaults restored). Self-only.

---

## 22. Presence & Status

Routes: `presence.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/presence/query` | JWT | Bulk presence lookup (max 100 IDs) |

```jsonc
{ "user_ids": ["uuid1", "uuid2"] }
// → { "presences": [ { "user_id": "...", "status": "online | idle | dnd | offline" } ] }
```

Real-time updates arrive over the gateway as `PresenceUpdate { user_id, status }`. Server-side, presence is stored in Redis with TTL refreshed by heartbeats; if every session of a user disconnects the gateway broadcasts `status: "offline"`.

`VALID_STATUSES = ["online", "idle", "dnd", "offline"]` (any other value via WS `PresenceUpdate` is rejected with an `Error` event).

---

## 23. E2EE — DM Prekeys (X3DH + PQ)

Routes: `keys.rs`. Implements Signal's X3DH with optional ML-KEM-768 post-quantum encapsulation (migration 021).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/keys/upload` | JWT | Upload prekey bundle |
| GET | `/api/keys/count/:device_id` | JWT | Remaining one-time prekey count |
| GET | `/api/keys/:user_id/:device_id` | JWT | Fetch bundle for a specific device — consumes one OTP prekey |
| GET | `/api/keys/:user_id` | JWT | Bundles for every device of `user_id` |

```jsonc
// Upload
{
  "device_id": "uuid",
  "identity_key": "base64",
  "signed_prekey": "base64",
  "signed_prekey_signature": "base64",
  "one_time_prekeys": ["base64", "base64", "..."],
  "pq_signed_prekey": "base64?",
  "pq_signed_prekey_signature": "base64?"
}
// → { "message": "Keys uploaded", "prekey_count": 50 }
```

```jsonc
// GET /api/keys/:user_id/:device_id
{
  "user_id": "uuid",
  "device_id": "uuid",
  "identity_key": "base64",
  "signed_prekey": "base64",
  "signed_prekey_signature": "base64",
  "one_time_prekey": "base64",
  "pq_signed_prekey": "base64?",
  "pq_signed_prekey_signature": "base64?"
}
```

One-time prekeys are marked `is_used = true` on issue and re-issued only when the bundle is replenished by another `/api/keys/upload`.

---

## 24. E2EE — Channel & DM Sender Keys

Routes: `channel_encryption.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/channels/:id/e2ee/distribute` | JWT | Push encrypted sender keys for a channel |
| GET | `/api/channels/:id/e2ee/my-key` | JWT | Fetch the caller's encrypted key for this channel |
| GET | `/api/channels/:id/e2ee/generation` | JWT | Current `key_generation` for the channel |
| POST | `/api/dms/:dm_id/e2ee/distribute` | JWT | Same, for a DM channel |
| GET | `/api/dms/:dm_id/e2ee/my-key` | JWT | Same, for a DM channel |

```jsonc
// Distribute
{
  "key_generation": 1,
  "recipients": [
    { "user_id": "uuid", "encrypted_key": "base64", "nonce": "base64" }
  ]
}

// My key
{ "encrypted_key": "base64", "nonce": "base64", "key_generation": 1, "distributor_user_id": "uuid" }
// or null if the caller has no key yet
```

`channels.e2ee_key_generation` is bumped server-side whenever a re-key is committed; clients observe it via `ChannelUpdate` (the channel info carries the field) and re-fetch their own key.

---

## 25. Devices & Push Notifications

Routes: `devices.rs`, `push.rs`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/devices` | JWT | My registered devices |
| POST | `/api/devices` | JWT | Register or update device |
| DELETE | `/api/devices/:device_id` | JWT | Unregister |
| PATCH | `/api/devices/:device_id/push-token` | JWT | Update push token |
| GET | `/api/push/vapid-key` | **None** | VAPID public key |

`device_type ∈ { "android", "ios", "desktop", "web" }`.

```jsonc
// POST /api/devices
{ "device_id": "uuid?", "device_name": "iPhone 15 Pro", "device_type": "ios", "push_token": "..." }
// → { "device": { "id": "uuid" } }
```

```jsonc
// GET /api/push/vapid-key
{ "public_key": "BPnJ..." }
```

Returns 503 if `VAPID_PUBLIC_KEY` is unset.

---

## 26. File Uploads & Attachments

Routes: `attachments.rs`, `files.rs`, `storage.rs`.

### 26.1 Generic upload (avatars / server icons)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/upload?purpose=avatar\|icon` | JWT | Multipart upload (`file`) |

When `purpose=avatar` or `purpose=icon`, the image is re-encoded to **256×256 WebP**. Returns `{ key, url, filename, content_type, size_bytes }`.

### 26.2 Message attachments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/channels/:channel_id/messages/:message_id/attachments` | JWT | Attach file to message |
| POST | `/api/dms/:dm_id/messages/:message_id/attachments` | JWT | Same for DMs |
| GET | `/api/messages/:message_id/attachments` | JWT | List attachments on a message |

Only the message author can attach. Returns `{ "attachment": Attachment }`.

```jsonc
{
  "attachment": {
    "id": "uuid",
    "filename": "photo.jpg",
    "content_type": "image/jpeg",
    "size": 1048576,
    "url": "https://minio.../presigned-url",
    "created_at": "..."
  }
}
```

### 26.3 Upload-subdomain bypass for >100 MB

Both message-attachment endpoints are **also reachable via `https://upload.jolkr.app/api/...`**. That host is a DNS-only A-record (no Cloudflare proxy) on the same backend, set up specifically to bypass Cloudflare's 100 MB request body limit on Free/Pro plans. The remote nginx (`jolkr-upload` proxy template) returns 404 for any path that isn't one of these two attachment endpoints — strict scope.

The frontend's `getUploadBaseUrl()` helper routes those two paths to the subdomain in Tauri and prod-web builds, and reuses the regular `/api` base in dev with a local backend.

### 26.4 File serving / presigned URLs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/files/:attachment_id` | JWT | Stream the file (Range supported) |
| GET | `/api/files/:attachment_id/url` | JWT | Return a fresh presigned S3 URL (4-hour TTL) |

### 26.5 Storage constraints

- **Max file size**: 250 MB (`MAX_FILE_SIZE` in `storage.rs`)
- **Allowed MIME**: `image/*, video/*, audio/*, application/pdf, text/plain, application/octet-stream`
- **MIME validation**: magic bytes (not the Content-Type header)
- **Filename sanitization**: strips path traversal + null bytes
- **Storage backend**: MinIO / S3
- **Public URLs**: rewritten through `MINIO_PUBLIC_URL` so the internal `minio:9000` hostname never leaks

---

## 27. GIFs & oEmbed

Routes: `gifs.rs`. Proxies GIPHY in a Tenor-v2-compatible shape (the FE uses `gif-picker-react`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/gifs/search?q=&limit=&pos=` | None | GIF search |
| GET | `/api/gifs/featured?limit=&pos=` | None | Trending |
| GET | `/api/gifs/categories` | None | Categories (cached) |
| GET | `/api/gifs/media?url=` | None | Proxy a GIPHY CDN URL |
| GET | `/api/gifs/i/:gif_id/:size` | None | Proxy GIF image by ID + size |
| GET | `/api/oembed?url=` | None | oEmbed proxy for link previews |
| GET | `/api/gifs/favorites` | JWT | List own favorites |
| POST | `/api/gifs/favorites` | JWT | `{ "gif_id": "..." }` (+ optional URL/title) |
| DELETE | `/api/gifs/favorites/:gif_id` | JWT | Remove favorite |

If `GIPHY_API_KEY` is unset, every proxy route returns **503 Service Unavailable**.

WS fan-out for favorites: `GifFavoriteUpdate { added?: FavoriteItem, removed_gif_id?: string }` — self-only.

---

## 28. Public Image Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/avatars/:user_id` | None | Cached user avatar (`Cache-Control: max-age=604800`) |
| GET | `/api/icons/:server_id` | None | Cached server icon (same cache header) |

Routes still pass through the standard rate limiter (60 burst, 30/s refill).

---

## 29. Health & Metrics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Service health (JSON or HTML based on Accept) |
| GET | `/metrics` | None | Prometheus / OpenMetrics text |

`/health` reports DB pool stats, Redis ping, NATS state, MinIO reachability, and the media server's `/health`. The route is **not** rate-limited and not timed (long-lived OK).

`/metrics` access is restricted to internal subnets at the **nginx** layer:
`127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`. All other clients receive `403 Forbidden`.

---

## 30. WebSocket Gateway (`/ws`)

Code: `jolkr-api/src/ws/handler.rs` + `ws/events.rs`.

### Connection

| Item | Value |
|------|-------|
| URL | `wss://jolkr.app/ws` |
| Max concurrent connections per IP | **10** |
| Max message size | **65 536 bytes** |
| Per-connection rate limit | 30 messages/sec, burst 30 (token bucket) |
| Backpressure queue | 256 outgoing events per connection (bounded mpsc) |
| Heartbeat | Client sends every ~30 s; server closes after **90 s** without one |
| Subscribe-on-Ready | Server auto-subscribes the session to every **server** the user is a member of (via `subscribe_servers`). Channel subscriptions are explicit, sent by the client. |
| Auth | JWT in the `Identify` payload. Validated with HS256; `jti` checked against the Redis `blacklist:` set; fails CLOSED on Redis error. |

### Client → Server events (`op` field)

```jsonc
{ "op": "Identify",       "d": { "token": "<jwt>" } }            // MUST be first
{ "op": "Heartbeat",      "d": { "seq": 42 } }                    // every ~30 s
{ "op": "Subscribe",      "d": { "channel_id": "uuid" } }
{ "op": "Unsubscribe",    "d": { "channel_id": "uuid" } }
{ "op": "TypingStart",    "d": { "channel_id": "uuid" } }
{ "op": "PresenceUpdate", "d": { "status": "online" | "idle" | "dnd" | "offline" } }
```

Subscribing to a channel the caller cannot `VIEW_CHANNELS` triggers `Error { message: "Cannot subscribe: no access to channel" }`. Re-`Identify` on an already authenticated socket → `Error { message: "Already identified" }`.

### Server → Client events (`GatewayEvent`)

Tag = `op`, payload = `d`. Source of truth: `ws/events.rs::GatewayEvent`.

| `op` | Payload | Notes |
|------|---------|-------|
| `Ready` | `{ user_id, session_id }` | Sent once after successful `Identify` |
| `HeartbeatAck` | `{ seq }` | Echo |
| `MessageCreate` | `{ message: MessageInfo }` | Channel and thread messages |
| `MessageUpdate` | `{ message: MessageInfo }` | Edit |
| `MessageDelete` | `{ message_id, channel_id }` | |
| `TypingStart` | `{ channel_id, user_id, timestamp }` | |
| `PresenceUpdate` | `{ user_id, status }` | Across all instances via NATS |
| `DmCreate` | `{ channel: DmChannelInfo }` | New group DM |
| `DmUpdate` | `{ channel: DmChannelInfo }` | Membership / name change |
| `DmClose` | `{ dm_id }` | Self-only — only the closer's other sessions |
| `DmMessageHide` | `{ dm_id, message_id }` | Self-only |
| `DmMessagesRead` | `{ dm_id, user_id, message_id }` | Suppressed if sender has `show_read_receipts=false` |
| `ThreadCreate` | `{ thread: ThreadInfo }` | |
| `ThreadUpdate` | `{ thread: ThreadInfo }` | |
| `ChannelCreate` | `{ channel: ChannelInfo }` | |
| `ChannelUpdate` | `{ channel: ChannelInfo }` | Includes move/reorder/E2EE generation bump |
| `ChannelDelete` | `{ channel_id, server_id }` | |
| `CategoryCreate` | `{ category: CategoryInfo }` | |
| `CategoryUpdate` | `{ category: CategoryInfo }` | |
| `CategoryDelete` | `{ category_id, server_id }` | |
| `MemberJoin` | `{ server_id, user_id }` | |
| `MemberLeave` | `{ server_id, user_id }` | Also drops all subscriptions for the kicked/banned user on that server (F06) |
| `MemberUpdate` | `{ server_id, user_id, timeout_until?, nickname?, role_ids? }` | Additive: only changed keys present; `nickname: ""` clears |
| `ServerUpdate` | `{ server: ServerInfo }` | |
| `ServerDelete` | `{ server_id }` | |
| `RoleCreate` | `{ server_id, role: RoleInfo }` | |
| `RoleUpdate` | `{ server_id, role: RoleInfo }` | Re-fetch channel perms after this |
| `RoleDelete` | `{ server_id, role_id }` | |
| `ChannelPermissionUpdate` | `{ channel_id, server_id, overwrites: ChannelOverwriteInfo[] }` | Full updated list |
| `ReactionUpdate` | `{ channel_id, message_id, reactions }` | Aggregated counts + user_ids |
| `PollUpdate` | `{ poll, channel_id, message_id }` | Snapshot |
| `DmCallRing` | `{ dm_id, caller_id, caller_username, is_video }` | |
| `DmCallAccept` | `{ dm_id, user_id }` | |
| `DmCallReject` | `{ dm_id, user_id }` | |
| `DmCallEnd` | `{ dm_id, user_id }` | |
| `ChannelMessagesRead` | `{ channel_id, user_id, message_id }` | |
| `ServerMessagesRead` | `{ server_id, user_id }` | All channels in a server marked read |
| `UserUpdate` | `{ user_id, status?, display_name?, avatar_url?, bio?, banner_color?, show_read_receipts?, dm_filter?, allow_friend_requests?, preferred_language? }` | Self-only privacy fields only on the user's own user-channel |
| `EmailVerified` | `{ user_id }` | Fired to every session of the verified user |
| `FriendshipUpdate` | `{ friendship, kind }` | `kind ∈ created | accepted | declined | removed | blocked` |
| `GifFavoriteUpdate` | `{ added?, removed_gif_id? }` | Self-only |
| `UserCallPresence` | `{ dm_id?, channel_id?, is_video? }` | Self-only; `dm_id` xor `channel_id`; both `null` ⇒ left/ended/rejected |
| `NotificationSettingUpdate` | `{ target_type, target_id, setting? }` | Self-only; `setting: null` ⇒ defaults restored |
| `Error` | `{ message }` | Generic, non-fatal |

### Wire format

```jsonc
{ "op": "Identify", "d": { "token": "eyJ..." } }
```

### Suggested client lifecycle

1. Open the socket.
2. Send `Identify` as the first frame.
3. Await `Ready` — read `user_id` and `session_id`.
4. Send `Heartbeat` every ~30 s; the server expects one within 90 s.
5. Track channel subscriptions explicitly with `Subscribe` / `Unsubscribe`.
6. Reconnect with exponential backoff on close; refresh the access token before reconnecting because the socket close may have been triggered by JWT expiry.

---

## 31. Voice WebSocket (`/media/ws/voice`)

Code: `jolkr-media/src/signaling.rs` + `jolkr-media/src/sfu/`.

The voice gateway is a **separate service** (Docker `jolkr-media`) that handles WebRTC signalling and forwards media through an SFU.

### Connection

| Item | Value |
|------|-------|
| URL (prod) | `wss://jolkr.app/media/ws/voice` |
| Internal port | `MEDIA_PORT` (default 8081) |
| Max concurrent connections per IP | **10** |
| Heartbeat | Server pings every 20 s; client must keep the socket reading; server closes after **90 s** of silence |
| Per-connection rate limit | 30 messages/sec, burst 30 |
| JWT validation | HS256 with `JWT_SECRET`; `jti` checked against the same Redis `blacklist:` set; fails CLOSED on Redis error |
| Media transport | WebRTC UDP on `MEDIA_UDP_PORT` (default range / configurable) |
| ICE candidates | Built from `PUBLIC_IP` + optional `LOCAL_IP`; falls back to the UDP bind address |

### Client → Server (`VoiceClientEvent`)

```jsonc
{ "op": "Identify",     "d": { "token": "<jwt>" } }            // MUST be first
{ "op": "Join",         "d": { "channel_id": "uuid", "with_video": false } }
{ "op": "Answer",       "d": { "sdp": "..." } }                 // response to server Offer
{ "op": "IceCandidate", "d": { "candidate": "..." } }
{ "op": "Leave",        "d": {} }
{ "op": "Mute",         "d": { "muted": true } }
{ "op": "Deafen",       "d": { "deafened": true } }
```

### Server → Client (`SignalOut`)

```jsonc
{ "op": "Joined",            "d": { "room_id": "uuid", "participants": [ParticipantInfo, ...] } }
{ "op": "Offer",             "d": { "sdp": "..." } }
{ "op": "ParticipantJoined", "d": { "user_id": "uuid", "has_video": false, "audio_mid": "...", "video_mid": "...?" } }
{ "op": "ParticipantLeft",   "d": { "user_id": "uuid" } }
{ "op": "MuteUpdate",        "d": { "user_id": "uuid", "muted": true } }
{ "op": "DeafenUpdate",      "d": { "user_id": "uuid", "deafened": true } }
{ "op": "Error",             "d": { "message": "..." } }
```

`ParticipantInfo`:

```jsonc
{ "user_id": "uuid", "is_muted": false, "is_deafened": false, "has_video": false,
  "audio_mid": "...", "video_mid": "...?" }
```

> `audio_mid` / `video_mid` are the Mids on the **recipient's** Rtc where that participant's media will arrive — they differ per recipient, so this struct is built per-recipient when the `Joined` payload is constructed.
>
> A `Speaking { user_id, speaking }` op is reserved for voice-activity detection but is **not** currently emitted.

### Voice ↔ chat coupling

When a user joins or leaves a voice channel/DM call, the API server emits a `UserCallPresence` event on the chat gateway (self-only) so the user's other sessions can show "On a call" UI. The voice service publishes presence over NATS so the API knows.

---

## 32. Environment Variables

### `jolkr-api` (`config.rs`)

| Variable | Default | Required? | Purpose |
|----------|---------|-----------|---------|
| `DATABASE_URL` | `postgres://jolkr:jolkr_dev@localhost:5432/jolkr` | yes (in prod) | Postgres DSN |
| `REDIS_URL` | `redis://localhost:6379` | yes | Sessions, rate limit, presence, blacklist |
| `JWT_SECRET` | — | **yes** | HS256 signing key, **min 32 chars** (server refuses to start otherwise) |
| `NATS_HMAC_SECRET` | — | **yes** | Cross-instance event-bus signing, **min 32 chars** |
| `MINIO_ACCESS_KEY` | — | **yes** | S3 access key |
| `MINIO_SECRET_KEY` | — | **yes** | S3 secret, **min 16 chars** |
| `SERVER_PORT` | `8080` | no | HTTP bind port |
| `MINIO_ENDPOINT` | `http://localhost:9000` | no | Internal S3 endpoint |
| `MINIO_PUBLIC_URL` | `http://localhost:9000` | no | Public URL prefix used for presigning |
| `MINIO_BUCKET` | `jolkr` | no | Bucket name |
| `NATS_URL` | `nats://localhost:4222` | no | NATS DSN |
| `NATS_USER` / `NATS_PASSWORD` | — | recommended in prod | Auth |
| `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` | — | no | Web Push (absence ⇒ 503 on `/api/push/vapid-key`) |
| `VAPID_SUBJECT` | `mailto:admin@jolkr.app` | no | Web Push subject |
| `MAIL_HOST` | — | no | SMTP host (no host ⇒ password-reset & verification emails silently no-op) |
| `MAIL_PORT` | `587` | no | SMTP port |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | — | no | SMTP auth |
| `MAIL_FROM_ADDRESS` | `noreply@jolkr.app` | no | From: header |
| `APP_URL` | `http://localhost/app` | no | Frontend URL used in reset links |
| `ADMIN_SECRET` | — | no | Guards admin endpoints; absence ⇒ those reject all traffic; <32 chars logs an error |
| `GIPHY_API_KEY` | — | no | Absence ⇒ 503 on `/api/gifs/*` |
| `MEDIA_SERVER_URL` | `http://jolkr-media:8081` | no | Polled by `/health` |
| `CORS_ORIGINS` | empty | no | Comma-separated origins; empty ⇒ localhost dev origins |
| `RUST_LOG` | `info` | no | Tracing filter |
| `JWT_MIN_ISSUED_AT` | — | no | Unix-seconds floor for access-token `iat` (SEC-011 forced logout) |

### `jolkr-media` (`config.rs`)

| Variable | Default | Required? | Purpose |
|----------|---------|-----------|---------|
| `MEDIA_PORT` | `8081` | no | HTTP+WS bind |
| `MEDIA_UDP_PORT` | configured | no | WebRTC UDP bind |
| `PUBLIC_IP` | `0.0.0.0` | yes for ICE | Advertised ICE candidate |
| `LOCAL_IP` | — | no | Additional LAN ICE candidate |
| `JWT_SECRET` | — | **yes** | Must match the API server |
| `REDIS_URL` | — | **yes** | Token blacklist lookups (fail-closed) |
| `NATS_URL` | — | **yes** | Presence publisher |
| `NATS_HMAC_SECRET` | — | **yes** | Presence event signing |
| `NATS_USER` / `NATS_PASSWORD` | — | recommended | NATS auth |

---

## 33. Database Tables

PostgreSQL via sqlx. Migrations in `jolkr-server/migrations/*.sql` (001 → 041). Notable highlights:

| Table | Purpose | Key columns / notes |
|-------|---------|---------------------|
| `users` | Accounts | id, email, username, display_name, avatar_url, status, bio, password_hash, banner_color, show_read_receipts, dm_filter ∈ all/friends/none, allow_friend_requests, preferred_language (BCP-47 lite), email_verified |
| `servers` | Guilds | id, name, description, icon_url, banner_url, owner_id, is_public, theme (JSONB) |
| `channels` | Server channels | id, server_id, category_id (NULL = uncategorized), name, topic, kind (text/voice), position, is_nsfw, slowmode_seconds, e2ee_key_generation |
| `categories` | Channel categories | id, server_id, name, position |
| `messages` | Channel/thread messages | id, channel_id, author_id, content, nonce, reply_to_id, thread_id, webhook_id, is_edited, is_pinned, created_at |
| `members` | Server membership | id, server_id, user_id, nickname, joined_at, timeout_until |
| `roles` | Server roles | id, server_id, name, color, position, permissions (BIGINT), is_default |
| `member_roles` | Role assignments | (member_id, role_id) — index on member_id added in 030 |
| `threads` | Thread state | id, channel_id, starter_msg_id, name, is_archived |
| `dm_channels` | DM channels | id, is_group, name (group only) |
| `dm_members` | DM membership | id, dm_channel_id, user_id |
| `dm_messages` | DM messages | id, dm_channel_id, author_id, content, nonce, is_edited |
| `dm_message_hidden` | "Only for me" deletes | (dm_message_id, user_id) — migration 039 |
| `friendships` | Friend graph | id, requester_id, addressee_id, status CHECK in (pending, accepted, blocked) |
| `devices` | Registered devices | id, user_id, device_name, device_type, push_token, last_active_at |
| `sessions` | Refresh sessions | id, user_id, device_id, refresh_token_hash, expires_at — truncated in 040 (SEC-011) |
| `user_keys` | X3DH prekeys | id, user_id, device_id, identity_key, signed_prekey, one_time_prekey, is_used + PQ columns (021) |
| `channel_encryption_keys` | Sender-key fan-out | id, channel_id, recipient_user_id, encrypted_key, nonce, key_generation, distributor_user_id |
| `reactions` | Channel reactions | id, message_id, user_id, emoji |
| `dm_reactions` | DM reactions | id, dm_message_id, user_id, emoji |
| `pins` | Channel pins | id, channel_id, message_id, pinned_by |
| `dm_pins` | DM pins | id, dm_channel_id, message_id, pinned_by |
| `webhooks` | Channel webhooks | id, channel_id, server_id, creator_id, name, avatar_url, token_hash (SHA-256) |
| `invites` | Server invites | id, server_id, creator_id, code, max_uses, use_count, expires_at |
| `polls` | Poll metadata | id, message_id, question, multi_select, anonymous, expires_at |
| `poll_options` | Poll options | id, poll_id, text, position |
| `poll_votes` | Poll votes | id, poll_id, option_id, user_id |
| `channel_read_states` | Channel read tracking | (user_id, channel_id) PK, last_read_message_id, updated_at — migration 031 |
| `notification_settings` | Mute/notification prefs | id, user_id, target_type, target_id, muted, mute_until, suppress_everyone |
| `audit_log` | Server audit trail | id, server_id, user_id, action_type, target_id, target_type, changes (JSONB), reason — indexed (server_id, created_at DESC) since 033 |
| `attachments` | Channel attachments | id, message_id, filename, content_type, size_bytes, url |
| `dm_attachments` | DM attachments | id, dm_message_id, filename, content_type, size_bytes, url |
| `channel_permission_overwrites` | Per-channel ACL | id, channel_id, target_type (role/member), target_id, allow, deny |
| `message_embeds` | Link embeds (channel) | id, message_id, url, title, description, image_url |
| `dm_message_embeds` | Link embeds (DM) | id, dm_message_id, url, title, description, image_url |
| `password_reset_tokens` | Hashed reset tokens | id, user_id, token_hash, expires_at |
| `email_verification_tokens` | Hashed verify tokens | id, user_id, token_hash, expires_at, used_at — migration 036 |
| `server_bans` | Ban records | id, server_id, user_id, banned_by, reason |
| `gif_favorites` | Per-user GIF favorites | id, user_id, gif_id, gif_url, preview_url, title, added_at |
| `server_emojis` | Custom emojis | id, server_id, name, image_url, uploader_id, animated |
| `server_positions` | Per-user server order | (user_id, server_id) PK, position — migration 025 |

Foreign-key cascades are used aggressively (delete a server → cascade to channels, roles, members, …).

---

## 34. Rate Limiting

All limiters are token-bucket, distributed via Redis with a local DashMap fallback (per-instance) so traffic survives a brief Redis outage.

| Group | Burst | Refill | Key strategy | Notes |
|-------|-------|--------|--------------|-------|
| Auth (`/api/auth/register, login, refresh, reset-password, forgot-password, reset-password-confirm, verify-email`) | 5 | 2/s | per IP | Strictest |
| General API (every authenticated route + public images + GIFs) | 60 | 30/s | per IP / per user | Default |
| Webhook execution (`POST /api/webhooks/:id/:token`) | 20 | 10/s | per webhook | Fail-closed on Redis error |
| WebSocket gateway | 30 | 30/s | per connection | Token bucket inside the handler |
| Voice WebSocket | 30 | 30/s | per connection | Same shape |
| Presence query | — | — | per call | Hard cap of 100 IDs per request |
| Failed-login lockout | 5 failures | 15-minute lockout | per email | Tracked in Redis |

The auth + general API + webhook limiters spawn periodic background cleanup tasks to evict stale DashMap entries (no memory leak).

---

## 35. Error Responses

All errors follow:

```jsonc
{ "error": { "code": 400, "message": "Descriptive error message" } }
```

| Code | Meaning |
|------|---------|
| `200` | OK with body |
| `201` | Created |
| `204` | OK, no body |
| `400` | Bad request / validation error |
| `401` | Unauthorized — missing/invalid/expired JWT, or token blacklisted |
| `403` | Forbidden — authenticated but insufficient permission |
| `404` | Not found |
| `413` | Payload too large (file >250 MB or multipart >260 MB) |
| `415` | Unsupported media type (MIME magic-byte check) |
| `422` | Validation error on body shape |
| `429` | Rate limited |
| `500` | Internal error |
| `503` | Dependency unavailable (DB / Redis / NATS / MinIO / GIPHY / SMTP) |

---

## 36. Security Architecture (selected hardening)

1. **JWT validation pinned to HS256** in both the API and the voice service; `Validation::default()` is never used.
2. **Token blacklist** — every logout writes `blacklist:{jti}` to Redis (TTL ≈ token lifetime). Checked on every authenticated HTTP request, on WS gateway `Identify`, and on voice WS `Identify`. **Fail-closed** on Redis error.
3. **SEC-011 forced logout (migration 040)** — `TRUNCATE sessions` plus the `JWT_MIN_ISSUED_AT` floor rejects pre-deploy access tokens immediately rather than at expiry.
4. **F06 channel-subscription cleanup** — `MemberLeave` (kick/ban) revokes WS subscriptions for that user on that server.
5. **F07 / F11 hardening** — per-IP caps (10) and per-conn rate limits (30/s) on both WebSocket gateways; Redis blacklist checked synchronously on voice Identify.
6. **Strict admin endpoints** — `ADMIN_SECRET` absence ⇒ all admin routes reject; <32 chars logs an error at boot.
7. **MinIO presigned URL hygiene** — the internal `minio:9000` host never leaves the server; URLs are rewritten through `MINIO_PUBLIC_URL`, and nginx restores `Host: minio:9000` on the way back so signatures stay valid.
8. **Magic-byte MIME validation** on every uploaded file, plus filename sanitization (path traversal, null bytes).
9. **Webhook rate limiting** is fail-closed: a Redis outage rejects executions rather than letting them through unlimited.
10. **CORS** — explicit origin list, no wildcard.
11. **Auth password rules** — minimum strength enforced server-side; bcrypt hashing for both passwords and refresh tokens.
12. **`/metrics` access** — restricted to RFC1918 subnets at the nginx layer.

---

## 37. Infrastructure Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Web framework | Axum 0.7 (Rust, workspace 0.11.3) | Async HTTP / WebSocket |
| Database | PostgreSQL + sqlx | Persistence |
| Cache | Redis | Sessions, rate limits, presence, token blacklist, failed-login lockout |
| Event bus | NATS (signed with HMAC) | Cross-instance pub/sub for WS fan-out |
| Object storage | MinIO (S3-compatible) | Files, avatars, emojis |
| Media | `jolkr-media` (str0m WebRTC SFU) | Voice/video signalling + UDP media relay |
| Push | Web Push (VAPID) | Browser/desktop notifications (FCM/APNs hints in code, not fully wired) |
| Email | SMTP (`MAIL_*`) | Password reset, email verification |
| Metrics | Prometheus / OpenMetrics via `/metrics` | Monitoring |
| Reverse proxy | nginx | TLS termination, request routing, `/metrics` ACL, `upload.jolkr.app` scope |
| CDN | Cloudflare (proxied; `upload.jolkr.app` is DNS-only to bypass the 100 MB body limit) | Edge |
