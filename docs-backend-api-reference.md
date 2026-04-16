# Jolkr Backend API Reference

> **Version**: 0.10.0
>
> Complete API reference for building frontend clients. All endpoints, WebSocket events, environment variables, database models, and architectural patterns.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Users](#2-users)
3. [Friends & Relationships](#3-friends--relationships)
4. [Direct Messages (DMs)](#4-direct-messages-dms)
5. [Servers](#5-servers)
6. [Channels](#6-channels)
7. [Categories](#7-categories)
8. [Messages](#8-messages)
9. [Threads](#9-threads)
10. [Roles & Permissions](#10-roles--permissions)
11. [Invites](#11-invites)
12. [Reactions](#12-reactions)
13. [Pins](#13-pins)
14. [Polls](#14-polls)
15. [Webhooks](#15-webhooks)
16. [Custom Emojis](#16-custom-emojis)
17. [E2EE Keys (Signal Protocol)](#17-e2ee-keys-signal-protocol)
18. [Channel E2EE (Sender Keys)](#18-channel-e2ee-sender-keys)
19. [Devices & Push Notifications](#19-devices--push-notifications)
20. [Notifications Settings](#20-notification-settings)
21. [Presence & Status](#21-presence--status)
22. [Audit Log](#22-audit-log)
23. [File Uploads](#23-file-uploads)
24. [Health & Metrics](#24-health--metrics)
25. [WebSocket Gateway](#25-websocket-gateway)
26. [Environment Variables](#26-environment-variables)
27. [Database Models](#27-database-models)
28. [Rate Limiting](#28-rate-limiting)
29. [Error Responses](#29-error-responses)
30. [Public Endpoints (No Auth)](#30-public-endpoints-no-auth)

---

## General Notes

- **Base URL**: `http://localhost:8080` (configurable via `SERVER_PORT`)
- **Auth header**: `Authorization: Bearer <access_token>` (marked as "JWT" below)
- **Content-Type**: `application/json` unless noted otherwise
- **UUIDs**: All IDs are UUID v4
- **E2EE**: The `encrypted_content` column has been removed. Encrypted messages use the `content` field (base64-encoded ciphertext) with a non-null `nonce` to indicate encryption

---

## 1. Authentication

All auth endpoints are rate-limited: **2 requests per 5 seconds per IP**.
Failed login attempts: **5 failures → 15 minute lockout** (tracked in Redis).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | None | Create new account |
| POST | `/api/auth/login` | None | Login with credentials |
| POST | `/api/auth/refresh` | None | Refresh access token |
| POST | `/api/auth/forgot-password` | None | Request password reset email |
| POST | `/api/auth/reset-password-confirm` | None | Confirm password reset with token |
| POST | `/api/auth/reset-password` | JWT | Admin password reset |
| POST | `/api/auth/change-password` | JWT | Change current user's password |
| POST | `/api/auth/logout` | JWT | Revoke refresh token |
| POST | `/api/auth/logout-all` | JWT | Revoke all sessions |
| POST | `/api/auth/verify-email` | None | Verify email address with token |
| POST | `/api/auth/resend-verification` | JWT | Resend verification email |

### POST `/api/auth/register`
```json
// Request
{ "email": "user@example.com", "username": "johndoe", "password": "SecurePass123!" }

// Response 200
{
  "user": { "id": "uuid", "email": "...", "username": "...", "display_name": null, "avatar_url": null, "status": null, "bio": null, "created_at": "..." },
  "tokens": { "access_token": "eyJ...", "refresh_token": "eyJ..." }
}
```

### POST `/api/auth/login`
```json
// Request
{ "email": "user@example.com", "password": "SecurePass123!" }

// Response 200 — same as register
```

### POST `/api/auth/refresh`
```json
// Request
{ "refresh_token": "eyJ..." }

// Response 200
{ "tokens": { "access_token": "eyJ...", "refresh_token": "eyJ..." } }
```

### POST `/api/auth/forgot-password`
```json
// Request
{ "email": "user@example.com" }

// Response 200
{ "message": "If the email exists, a reset link has been sent." }
```

### POST `/api/auth/reset-password-confirm`
```json
// Request
{ "token": "reset-token-from-email", "new_password": "NewSecurePass456!" }

// Response 200
{}
```

### POST `/api/auth/change-password`
```json
// Request
{ "current_password": "OldPass", "new_password": "NewPass" }
// Response 200
{}
```

### POST `/api/auth/logout`
```json
// Request
{ "refresh_token": "eyJ..." }
// Response 200
{}
```

### JWT Token Details
- **Algorithm**: HS256 (HMAC-SHA256)
- **Claims**: `{ sub: user_id, iat, exp, device_id?, jti: token_id }`
- **Access token**: Short-lived (~1 hour)
- **Refresh token**: Stored as bcrypt hash in `sessions` table

### Auth Flow for Frontend Clients
1. Register or login → receive `access_token` + `refresh_token`
2. Store both tokens (e.g., localStorage or secure storage)
3. Use `Authorization: Bearer <access_token>` on all API calls
4. When access token expires (401), call `/api/auth/refresh`
5. On logout, call `/api/auth/logout` to invalidate refresh token

---

## 2. Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/@me` | JWT | Get current user profile |
| PATCH | `/api/users/@me` | JWT | Update current user |
| GET | `/api/users/:id` | JWT | Get user profile by ID |
| POST | `/api/users/batch` | JWT | Get multiple users at once |
| GET | `/api/users/search?q=query` | JWT | Search users |

### GET `/api/users/@me`
```json
// Response 200
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "johndoe",
    "display_name": "John Doe",
    "avatar_url": "https://...",
    "status": "online",
    "bio": "Hello world",
    "show_read_receipts": true,
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

### PATCH `/api/users/@me`
```json
// Request — all fields optional
{
  "display_name": "New Name",
  "avatar_url": "https://...",
  "status": "online",
  "bio": "Updated bio",
  "show_read_receipts": false
}
```

### POST `/api/users/batch`
```json
// Request — max 100 user IDs per request
{ "ids": ["uuid1", "uuid2", "uuid3"] }

// Response 200
{ "users": [ { "id": "...", "username": "...", ... } ] }
```

### GET `/api/users/search?q=john`
- **Query param**: `q` (min 3 characters, exact match on username only — email excluded for privacy)
- Returns max 3 results
```json
{ "users": [ { "id": "...", "username": "...", ... } ] }
```

---

## 3. Friends & Relationships

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/friends` | JWT | List accepted friends |
| GET | `/api/friends/pending` | JWT | List pending friend requests |
| POST | `/api/friends` | JWT | Send friend request |
| POST | `/api/friends/:id/accept` | JWT | Accept friend request |
| DELETE | `/api/friends/:id` | JWT | Decline/remove friend |
| POST | `/api/friends/block` | JWT | Block a user |

### POST `/api/friends`
```json
// Request
{ "user_id": "uuid-of-target-user" }

// Response 200
{
  "friendship": {
    "id": "uuid",
    "requester_id": "uuid",
    "addressee_id": "uuid",
    "status": "pending",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

### Friendship Statuses
- `"pending"` — request sent, awaiting acceptance
- `"accepted"` — mutual friendship
- `"blocked"` — user blocked

> **Note**: Enforced via CHECK constraint on `friendships.status` — only these three values are allowed.

---

## 4. Direct Messages (DMs)

### DM Channels

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dms` | JWT | List all DM channels |
| POST | `/api/dms` | JWT | Create 1-on-1 or group DM |
| PATCH | `/api/dms/:dm_id` | JWT | Update DM (rename group) |
| PUT | `/api/dms/:dm_id/members` | JWT | Add member to group DM |
| DELETE | `/api/dms/:dm_id/members/@me` | JWT | Leave DM |
| POST | `/api/dms/:dm_id/close` | JWT | Close/hide DM |

### POST `/api/dms` — Create DM
```json
// 1-on-1 DM
{ "user_id": "uuid" }

// Group DM
{ "user_ids": ["uuid1", "uuid2"], "name": "Group Chat Name" }
```

### DM Messages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dms/:dm_id/messages` | JWT | Get DM messages |
| POST | `/api/dms/:dm_id/messages` | JWT | Send DM message |
| PATCH | `/api/dms/messages/:id` | JWT | Edit DM message |
| DELETE | `/api/dms/messages/:id` | JWT | Delete DM message |

**Query params for GET messages**: `limit` (default 50), `before` (ISO 8601 datetime cursor)

### POST `/api/dms/:dm_id/messages`
```json
// Plaintext
{ "content": "Hello!" }

// Encrypted (E2EE) — content holds base64-encoded ciphertext, nonce indicates encryption
{ "content": "<base64-ciphertext>", "nonce": "<base64-nonce>" }
```

### DM Reactions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dms/messages/:id/reactions` | JWT | List reactions |
| POST | `/api/dms/messages/:id/reactions` | JWT | Add reaction |
| DELETE | `/api/dms/messages/:id/reactions/:emoji` | JWT | Remove reaction |

```json
// Add reaction
{ "emoji": "👍" }
```

### DM Pins

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dms/:dm_id/pins` | JWT | Get pinned messages |
| POST | `/api/dms/:dm_id/pins/:message_id` | JWT | Pin message |
| DELETE | `/api/dms/:dm_id/pins/:message_id` | JWT | Unpin message |

### DM Read Receipts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/dms/:dm_id/read` | JWT | Mark DM as read |

```json
{ "message_id": "uuid-of-last-read-message" }
```

Broadcasts `DmMessagesRead` WS event to all DM members.

### DM Calls

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/dms/:dm_id/call` | JWT | Initiate call |
| POST | `/api/dms/:dm_id/call/accept` | JWT | Accept call |
| POST | `/api/dms/:dm_id/call/reject` | JWT | Reject call |
| POST | `/api/dms/:dm_id/call/end` | JWT | End call |

### DM E2EE Key Distribution

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/dms/:dm_id/e2ee/distribute` | JWT | Distribute encrypted keys |
| GET | `/api/dms/:dm_id/e2ee/my-key` | JWT | Get my E2EE key for this DM |

```json
// Distribute keys
{
  "key_generation": 1,
  "recipients": [
    { "user_id": "uuid", "encrypted_key": "base64...", "nonce": "base64..." }
  ]
}

// Get my key response
{ "encrypted_key": "base64...", "nonce": "base64...", "key_generation": 1 }
```

### DM Attachments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/dms/:dm_id/messages/:message_id/attachments` | JWT | Upload attachment (multipart) |

---

## 5. Servers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers` | JWT | List user's servers |
| POST | `/api/servers` | JWT | Create server |
| GET | `/api/servers/discover` | JWT | Discover public servers |
| GET | `/api/servers/:id` | JWT | Get server details |
| PATCH | `/api/servers/:id` | JWT | Update server |
| DELETE | `/api/servers/:id` | JWT | Delete server (owner only) |
| POST | `/api/servers/:id/join` | JWT | Join public server |
| PUT | `/api/users/@me/servers/reorder` | JWT | Reorder server list |

### POST `/api/servers`
```json
// Request — only name is required; icon/banner set via separate upload + PATCH
{
  "name": "My Server",
  "description": "A cool server"
}

// Response 200
{
  "server": {
    "id": "uuid",
    "name": "My Server",
    "description": "A cool server",
    "icon_url": null,
    "banner_url": null,
    "owner_id": "uuid",
    "is_public": false,
    "member_count": 1
  }
}
```

### PATCH `/api/servers/:id`
```json
// All fields optional
{
  "name": "Updated Name",
  "description": "Updated description",
  "icon_url": "https://...",
  "banner_url": "https://...",
  "is_public": true
}
```

### GET `/api/servers/discover?limit=20&offset=0`
```json
{ "servers": [...], "total": 42 }
```

### PUT `/api/users/@me/servers/reorder`
```json
{ "server_ids": ["uuid-1", "uuid-2", "uuid-3"] }
```
Order of `server_ids` determines display position (index = position).

### Server Members

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:id/members` | JWT | List members |
| DELETE | `/api/servers/:id/members/@me` | JWT | Leave server |
| DELETE | `/api/servers/:id/members/:user_id` | JWT | Kick member |
| PATCH | `/api/servers/:id/members/:user_id/nickname` | JWT | Set member nickname |
| POST | `/api/servers/:id/members/:user_id/timeout` | JWT | Timeout member |
| DELETE | `/api/servers/:id/members/:user_id/timeout` | JWT | Remove timeout |
| POST | `/api/servers/:id/read-all` | JWT | Mark all channels as read |

**Query params for GET members**: `limit`, `offset`

### POST `/api/servers/:id/read-all`
Marks all channels in the server as read for the current user. Broadcasts `ServerMessagesRead` WS event.
No request body needed.

### POST `/api/servers/:id/members/:user_id/timeout`
```json
{ "timeout_until": "2026-04-08T12:00:00Z" }
```
Must be a future datetime, max 28 days from now.

### PATCH `/api/servers/:id/members/:user_id/nickname`
```json
{ "nickname": "CoolNick" }
// Set to null to remove nickname
{ "nickname": null }
```

### Server Bans

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:id/bans` | JWT | List banned users |
| POST | `/api/servers/:id/bans` | JWT | Ban user |
| DELETE | `/api/servers/:id/bans/:user_id` | JWT | Unban user |

```json
// Ban request
{ "user_id": "uuid", "reason": "Rule violation" }
```

---

## 6. Channels

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/servers/:server_id/channels` | JWT | Create channel |
| GET | `/api/servers/:server_id/channels/list` | JWT | List server channels |
| PUT | `/api/servers/:server_id/channels/reorder` | JWT | Reorder channels |
| GET | `/api/channels/:id` | JWT | Get channel details |
| PATCH | `/api/channels/:id` | JWT | Update channel |
| DELETE | `/api/channels/:id` | JWT | Delete channel |

### POST `/api/servers/:server_id/channels`
```json
{
  "name": "general",
  "kind": "text",
  "category_id": "uuid-or-null"
}
```
> Note: `topic`, `is_nsfw`, `slowmode_seconds` are set via PATCH after creation.

### Channel Types (`kind`)
- `"text"` — Standard text channel
- `"voice"` — Voice channel

### Channel Response
```json
{
  "channel": {
    "id": "uuid",
    "server_id": "uuid",
    "category_id": "uuid|null",
    "name": "general",
    "topic": "General discussion",
    "kind": "text",
    "position": 0,
    "is_nsfw": false,
    "slowmode_seconds": 0,
    "e2ee_key_generation": 0
  }
}
```

### PUT `/api/servers/:server_id/channels/reorder`
```json
{ "channel_positions": [{ "id": "uuid", "position": 0 }, { "id": "uuid", "position": 1 }] }
```

### Channel Read State

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/channels/:id/read` | JWT | Mark channel as read |

```json
{ "message_id": "uuid-of-last-read-message" }
```

Broadcasts `ChannelMessagesRead` WS event to all server members.

### Channel Permission Overwrites

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:id/permissions/@me` | JWT | Get my computed permissions |
| GET | `/api/channels/:id/overwrites` | JWT | List permission overwrites |
| PUT | `/api/channels/:id/overwrites` | JWT | Set/update overwrite |
| DELETE | `/api/channels/:id/overwrites/:target_type/:target_id` | JWT | Delete overwrite |

```json
// Set overwrite — target_type is "user" or "role"
{
  "target_type": "role",
  "target_id": "uuid",
  "allow": 1024,
  "deny": 0
}

// Get my permissions response
{ "permissions": 2147483647 }
```

---

## 7. Categories

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/categories` | JWT | List categories |
| POST | `/api/servers/:server_id/categories` | JWT | Create category |
| PATCH | `/api/categories/:id` | JWT | Update category |
| DELETE | `/api/categories/:id` | JWT | Delete category |

```json
// Create category
{ "name": "Voice Channels", "position": 2 }
```

---

## 8. Messages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:id/messages` | JWT | Get channel messages |
| POST | `/api/channels/:id/messages` | JWT | Send message |
| GET | `/api/channels/:id/messages/search` | JWT | Search messages |
| PATCH | `/api/messages/:id` | JWT | Edit message |
| DELETE | `/api/messages/:id` | JWT | Delete message |

### GET `/api/channels/:id/messages`
**Query params**: `limit` (default 50), `before` (ISO 8601 datetime cursor)

### POST `/api/channels/:id/messages`
```json
// Plaintext message
{ "content": "Hello, world!" }

// Reply to another message
{ "content": "I agree!", "reply_to_id": "uuid-of-original-message" }

// Encrypted message — content holds base64-encoded ciphertext, nonce indicates encryption
{ "content": "<base64-ciphertext>", "nonce": "<base64-nonce>" }
```

### PATCH `/api/messages/:id` — Edit Message
```json
// Plaintext edit
{ "content": "Updated text" }

// Encrypted edit — include updated nonce
{ "content": "<base64-ciphertext>", "nonce": "<base64-nonce>" }
```

### Message Response
```json
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
    "attachments": [],
    "reactions": [],
    "embeds": [],
    "poll": null,
    "created_at": "2026-04-01T00:00:00Z",
    "updated_at": "2026-04-01T00:00:00Z"
  }
}
```

### GET `/api/channels/:id/messages/search`
**Query params**: `q` (search term), `from` (username), `has` (attachment type), `before` (datetime), `after` (datetime), `limit`
```json
{ "messages": [...], "total": 15 }
```

### Message Attachments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/channels/:channel_id/messages/:message_id/attachments` | JWT | Upload attachment (multipart) |
| GET | `/api/messages/:message_id/attachments` | JWT | List attachments |

---

## 9. Threads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:channel_id/threads` | JWT | List threads |
| POST | `/api/channels/:channel_id/threads` | JWT | Create thread |
| GET | `/api/threads/:thread_id` | JWT | Get thread details |
| PATCH | `/api/threads/:thread_id` | JWT | Update thread |
| GET | `/api/threads/:thread_id/messages` | JWT | Get thread messages |
| POST | `/api/threads/:thread_id/messages` | JWT | Send message in thread |

### POST `/api/channels/:channel_id/threads`
```json
// Request — message_id is required (starts thread from that message)
{ "message_id": "uuid-of-starter-message", "name": "Discussion about feature X" }

// Response 200
{
  "thread": {
    "id": "uuid",
    "channel_id": "uuid",
    "starter_msg_id": "uuid",
    "name": "Discussion about feature X",
    "is_archived": false,
    "message_count": 0,
    "created_at": "...",
    "updated_at": "..."
  },
  "message": { ... }
}
```

### PATCH `/api/threads/:thread_id`
```json
{ "name": "Renamed thread", "is_archived": true }
```

### GET `/api/channels/:channel_id/threads?include_archived=true`

---

## 10. Roles & Permissions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/roles` | JWT | List all server roles |
| POST | `/api/servers/:server_id/roles` | JWT | Create role |
| PATCH | `/api/roles/:id` | JWT | Update role |
| DELETE | `/api/roles/:id` | JWT | Delete role |
| PUT | `/api/servers/:server_id/roles/:role_id/members` | JWT | Assign role to user |
| DELETE | `/api/servers/:server_id/roles/:role_id/members/:user_id` | JWT | Remove role from user |
| GET | `/api/servers/:server_id/members-with-roles` | JWT | List members with their roles |
| GET | `/api/servers/:server_id/permissions/@me` | JWT | Get my server permissions |

### POST `/api/servers/:server_id/roles`
```json
{
  "name": "Moderator",
  "color": 3447003,
  "permissions": 1099511627775
}
```

### Role Response
```json
{
  "role": {
    "id": "uuid",
    "server_id": "uuid",
    "name": "Moderator",
    "color": 3447003,
    "position": 1,
    "permissions": 1099511627775,
    "is_default": false
  }
}
```

### PUT `/api/servers/:server_id/roles/:role_id/members`
```json
{ "user_id": "uuid" }
```

### Permission Bitfield

Permissions are stored as a 64-bit integer (bitfield). Each bit represents a permission:

| Permission | Bit | Value | Description |
|-----------|-----|-------|-------------|
| VIEW_CHANNEL | 0 | 1 | View channels |
| SEND_MESSAGES | 1 | 2 | Send messages in channels |
| MANAGE_MESSAGES | 2 | 4 | Delete/pin messages by others |
| MANAGE_CHANNELS | 3 | 8 | Create/edit/delete channels |
| MANAGE_SERVER | 4 | 16 | Edit server settings |
| MANAGE_ROLES | 5 | 32 | Create/edit/delete roles |
| KICK_MEMBERS | 6 | 64 | Kick members |
| BAN_MEMBERS | 7 | 128 | Ban/unban members |
| CREATE_INVITES | 8 | 256 | Create invite links |
| MANAGE_WEBHOOKS | 9 | 512 | Create/edit/delete webhooks |
| MANAGE_EMOJIS | 10 | 1024 | Upload/delete custom emojis |
| MANAGE_THREADS | 11 | 2048 | Manage threads |
| ADMINISTRATOR | 12 | 4096 | Full permissions (overrides all) |

> **Note**: Server owners always have all permissions regardless of role assignments.

### Permission Calculation
1. Start with `@everyone` role permissions (the default role)
2. OR together all assigned role permissions
3. Apply channel overwrites: add `allow` bits, remove `deny` bits
4. If ADMINISTRATOR bit is set, grant all permissions

---

## 11. Invites

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/invites` | JWT | List server invites |
| POST | `/api/servers/:server_id/invites` | JWT | Create invite |
| DELETE | `/api/servers/:server_id/invites/:invite_id` | JWT | Delete invite |
| POST | `/api/invites/:code` | JWT | Join server via invite code |

### POST `/api/servers/:server_id/invites`
```json
// Request — all fields optional
{
  "max_uses": 10,
  "max_age_seconds": 86400
}

// Response 200
{
  "invite": {
    "id": "uuid",
    "server_id": "uuid",
    "creator_id": "uuid",
    "code": "abc123XYZ",
    "max_uses": 10,
    "use_count": 0,
    "expires_at": "2026-04-01T00:00:00Z"
  }
}
```

### POST `/api/invites/:code` — Join via invite
No request body needed. Returns the invite info on success.

---

## 12. Reactions

### Channel Message Reactions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/messages/:id/reactions` | JWT | Add reaction |
| GET | `/api/messages/:id/reactions` | JWT | List reactions |
| DELETE | `/api/messages/:message_id/reactions/:emoji` | JWT | Remove my reaction |

```json
// Add reaction
{ "emoji": "🔥" }

// List reactions response — raw rows (client aggregates into count/me format)
{
  "reactions": [
    { "id": "uuid", "message_id": "uuid", "user_id": "uuid1", "emoji": "🔥", "created_at": "..." },
    { "id": "uuid", "message_id": "uuid", "user_id": "uuid2", "emoji": "🔥", "created_at": "..." }
  ]
}
```

### DM Message Reactions
Same pattern at `/api/dms/messages/:id/reactions` (see section 4).

---

## 13. Pins

### Channel Pins

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:channel_id/pins` | JWT | List pinned messages |
| POST | `/api/channels/:channel_id/pins/:message_id` | JWT | Pin message |
| DELETE | `/api/channels/:channel_id/pins/:message_id` | JWT | Unpin message |

### DM Pins
Same pattern at `/api/dms/:dm_id/pins/...` (see section 4).

---

## 14. Polls

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/channels/:id/polls` | JWT | Create poll |
| GET | `/api/polls/:id` | JWT | Get poll details |
| POST | `/api/polls/:id/vote` | JWT | Vote on poll |
| DELETE | `/api/polls/:id/vote` | JWT | Remove vote |

### POST `/api/channels/:id/polls`
```json
// Request
{
  "question": "What should we build next?",
  "options": ["Feature A", "Feature B", "Feature C"],
  "multi_select": false,
  "anonymous": false,
  "expires_at": "2026-04-08T12:00:00Z"
}

// Response 200
{
  "poll": {
    "id": "uuid",
    "message_id": "uuid",
    "channel_id": "uuid",
    "question": "What should we build next?",
    "multi_select": false,
    "anonymous": false,
    "expires_at": "2026-04-08T12:00:00Z",
    "options": [
      { "id": "uuid", "text": "Feature A", "position": 0 },
      { "id": "uuid", "text": "Feature B", "position": 1 },
      { "id": "uuid", "text": "Feature C", "position": 2 }
    ],
    "votes": {},
    "my_votes": [],
    "total_votes": 0,
    "created_at": "..."
  },
  "message": { ... }
}
```

### POST `/api/polls/:id/vote`
```json
{ "option_id": "uuid" }
```

---

## 15. Webhooks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/channels/:id/webhooks` | JWT | List webhooks |
| POST | `/api/channels/:id/webhooks` | JWT | Create webhook |
| PATCH | `/api/webhooks/:id` | JWT | Update webhook |
| DELETE | `/api/webhooks/:id` | JWT | Delete webhook |
| POST | `/api/webhooks/:id/token` | JWT | Regenerate token |
| POST | `/api/webhooks/:id/:token` | **None** | Execute webhook (send message) |

### POST `/api/channels/:id/webhooks`
```json
{ "name": "GitHub Bot", "avatar_url": "https://..." }
```

### POST `/api/webhooks/:id/:token` — Execute (no auth needed)
```json
{ "content": "New commit pushed!", "username": "GitHub Bot", "avatar_url": "https://..." }
```
> `username` and `avatar_url` are optional overrides for the webhook's defaults.

**Rate limit**: 5 executions per second per webhook (distributed via Redis).

---

## 16. Custom Emojis

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/emojis` | JWT | List server emojis |
| POST | `/api/servers/:server_id/emojis` | JWT | Upload custom emoji (multipart) |
| DELETE | `/api/emojis/:emoji_id` | JWT | Delete emoji |

### POST `/api/servers/:server_id/emojis`
Multipart form data with fields: `name` (string), `file` (image file).

```json
// Response 200
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

## 17. E2EE Keys (Signal Protocol / X3DH)

Used for DM end-to-end encryption. Implements the X3DH (Extended Triple Diffie-Hellman) key agreement protocol with optional ML-KEM-768 post-quantum key encapsulation.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/keys/upload` | JWT | Upload prekey bundle |
| GET | `/api/keys/count/:device_id` | JWT | Check remaining one-time prekeys |
| GET | `/api/keys/:user_id/:device_id` | JWT | Get prekey bundle for user's device |
| GET | `/api/keys/:user_id` | JWT | Get all devices' prekey bundles |

### POST `/api/keys/upload`
```json
{
  "device_id": "uuid",
  "identity_key": "base64...",
  "signed_prekey": "base64...",
  "signed_prekey_signature": "base64...",
  "one_time_prekeys": ["base64...", "base64...", "base64..."],
  "pq_signed_prekey": "base64...",
  "pq_signed_prekey_signature": "base64..."
}

// Response 200
{ "message": "Keys uploaded", "prekey_count": 50 }
```

### GET `/api/keys/:user_id/:device_id`
```json
{
  "user_id": "uuid",
  "device_id": "uuid",
  "identity_key": "base64...",
  "signed_prekey": "base64...",
  "signed_prekey_signature": "base64...",
  "one_time_prekey": "base64...",
  "pq_signed_prekey": "base64...",
  "pq_signed_prekey_signature": "base64..."
}
```

---

## 18. Channel E2EE (Sender Keys)

Used for end-to-end encryption in server channels and group DMs using the Sender Keys protocol.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/channels/:id/e2ee/distribute` | JWT | Distribute encrypted channel keys |
| GET | `/api/channels/:id/e2ee/my-key` | JWT | Get my channel E2EE key |
| GET | `/api/channels/:id/e2ee/generation` | JWT | Get current key generation |

### POST `/api/channels/:id/e2ee/distribute`
```json
{
  "key_generation": 1,
  "recipients": [
    { "user_id": "uuid", "encrypted_key": "base64...", "nonce": "base64..." },
    { "user_id": "uuid", "encrypted_key": "base64...", "nonce": "base64..." }
  ]
}
```

### GET `/api/channels/:id/e2ee/my-key`
```json
{ "encrypted_key": "base64...", "nonce": "base64...", "key_generation": 1 }
```

### GET `/api/channels/:id/e2ee/generation`
```json
{ "key_generation": 1 }
```

---

## 19. Devices & Push Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/devices` | JWT | List my devices |
| POST | `/api/devices` | JWT | Register a device |
| DELETE | `/api/devices/:device_id` | JWT | Unregister device |
| PATCH | `/api/devices/:device_id/push-token` | JWT | Update push token |
| GET | `/api/push/vapid-key` | **None** | Get VAPID public key |

### POST `/api/devices`
```json
{
  "device_id": "uuid-optional",
  "device_name": "iPhone 15 Pro",
  "device_type": "ios",
  "push_token": "firebase-or-apns-token"
}
```

### Device Types
- `"android"` — Android (FCM)
- `"ios"` — iOS (APNs)
- `"desktop"` — Desktop (Tauri)
- `"web"` — Web browser (Web Push)

### GET `/api/push/vapid-key`
```json
{ "public_key": "BPnJ..." }
```

---

## 20. Notification Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/me/notifications` | JWT | List all notification settings |
| GET | `/api/users/me/notifications/:target_type/:target_id` | JWT | Get notification setting |
| PUT | `/api/users/me/notifications/:target_type/:target_id` | JWT | Update notification setting |

### Target Types
- `"server"` — Server-level mute
- `"channel"` — Channel-level mute

### PUT `/api/users/me/notifications/server/:server_id`
```json
{
  "muted": true,
  "mute_until": "2026-04-01T00:00:00Z",
  "suppress_everyone": true
}
```

---

## 21. Presence & Status

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/presence/query` | JWT | Query user presence |

### POST `/api/presence/query`
```json
// Request — max 100 user IDs per request
{ "user_ids": ["uuid1", "uuid2", "uuid3"] }

// Response 200
{
  "presences": [
    { "user_id": "uuid1", "status": "online" },
    { "user_id": "uuid2", "status": "idle" },
    { "user_id": "uuid3", "status": "offline" }
  ]
}
```

### Valid Statuses
- `"online"` — Active
- `"idle"` — Away / inactive
- `"dnd"` — Do Not Disturb
- `"offline"` — Disconnected

---

## 22. Audit Log

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/servers/:server_id/audit-log` | JWT | Get audit log entries |

**Requires**: Server owner or `MANAGE_SERVER` permission.

### GET `/api/servers/:server_id/audit-log?action=member_kick&limit=50&before=uuid`

```json
{
  "entries": [
    {
      "id": "uuid",
      "server_id": "uuid",
      "user_id": "uuid",
      "action_type": "member_kick",
      "target_id": "uuid",
      "target_type": "member",
      "changes": { "reason": "Spamming" },
      "reason": "Violated rules",
      "created_at": "..."
    }
  ]
}
```

---

## 23. File Uploads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/upload` | JWT | Upload file (generic) |
| GET | `/api/files/:attachment_id` | JWT | Serve file by attachment ID |

### Constraints
- **Max file size**: 26 MB
- **Allowed MIME types**: `image/*`, `video/*`, `audio/*`, `application/pdf`, `text/plain`, `application/octet-stream`
- **MIME validation**: Magic bytes (not just Content-Type header)
- **Filename sanitization**: Removes path traversal, null bytes
- **Storage**: MinIO/S3
- **Access**: Via presigned URLs (4-hour expiry)

### Attachment Response
```json
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

---

## 24. Health & Metrics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Service health check |
| GET | `/metrics` | None | Prometheus metrics |

### GET `/health`
Returns JSON or HTML (based on Accept header) with database connection pool stats and service status.

### GET `/metrics`
Returns OpenMetrics/Prometheus format (`text/plain`).

**Access restricted** to internal networks only (nginx-enforced):
- `127.0.0.1` (localhost)
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (private ranges)
- All other IPs receive `403 Forbidden`

---

## 25. WebSocket Gateway

### Connection
```
ws://localhost:8080/ws
```

### Connection Limits
- **10 concurrent connections per IP**
- **30 messages per second per connection** (token bucket)
- **90 second heartbeat timeout** (server disconnects if no heartbeat)
- **65 KB max message size**

### Client → Server Events

| Op | Data | Description |
|----|------|-------------|
| `Identify` | `{ token: "JWT..." }` | **Must be first message** — authenticates the connection |
| `Heartbeat` | `{ seq: 42 }` | Keep connection alive (send every ~45 seconds) |
| `Subscribe` | `{ channel_id: "uuid" }` | Subscribe to channel events |
| `Unsubscribe` | `{ channel_id: "uuid" }` | Unsubscribe from channel events |
| `TypingStart` | `{ channel_id: "uuid" }` | Broadcast typing indicator |
| `PresenceUpdate` | `{ status: "online" }` | Update presence status |

### Server → Client Events

| Op | Data | Description |
|----|------|-------------|
| `Ready` | `{ user_id, session_id }` | Connection authenticated successfully |
| `HeartbeatAck` | `{ seq }` | Heartbeat acknowledged |
| `MessageCreate` | `{ message: MessageInfo }` | New message in subscribed channel |
| `MessageUpdate` | `{ message: MessageInfo }` | Message edited |
| `MessageDelete` | `{ message_id, channel_id }` | Message deleted |
| `TypingStart` | `{ channel_id, user_id, timestamp }` | User started typing |
| `PresenceUpdate` | `{ user_id, status }` | User presence changed |
| `DmCreate` | `{ channel: DmChannelInfo }` | New DM channel created |
| `DmUpdate` | `{ channel: DmChannelInfo }` | DM channel updated |
| `DmMessagesRead` | `{ dm_id, user_id, message_id }` | DM read receipt |
| `ThreadCreate` | `{ thread: ThreadInfo }` | New thread created |
| `ThreadUpdate` | `{ thread: ThreadInfo }` | Thread updated |
| `ChannelCreate` | `{ channel: ChannelInfo }` | New channel created |
| `ChannelUpdate` | `{ channel: ChannelInfo }` | Channel updated |
| `ChannelDelete` | `{ channel_id, server_id }` | Channel deleted |
| `MemberJoin` | `{ server_id, user_id }` | User joined server |
| `MemberLeave` | `{ server_id, user_id }` | User left/kicked from server |
| `MemberUpdate` | `{ server_id, user_id, timeout_until? }` | Member updated (timeout changed) |
| `ServerUpdate` | `{ server: ServerInfo }` | Server settings updated |
| `ServerDelete` | `{ server_id }` | Server deleted |
| `ReactionUpdate` | `{ channel_id, message_id, reactions }` | Reactions changed on message |
| `PollUpdate` | `{ poll, channel_id, message_id }` | Poll state changed |
| `DmCallRing` | `{ dm_id, caller_id, caller_username }` | Incoming DM call |
| `DmCallAccept` | `{ dm_id, user_id }` | Call accepted |
| `DmCallReject` | `{ dm_id, user_id }` | Call rejected |
| `DmCallEnd` | `{ dm_id, user_id }` | Call ended |
| `UserUpdate` | `{ user_id, status?, display_name?, avatar_url?, bio? }` | User profile updated |
| `CategoryCreate` | `{ category: CategoryInfo }` | New category created |
| `CategoryUpdate` | `{ category: CategoryInfo }` | Category updated |
| `CategoryDelete` | `{ category_id, server_id }` | Category deleted |
| `ChannelMessagesRead` | `{ channel_id, user_id, message_id }` | Channel read receipt |
| `ServerMessagesRead` | `{ server_id, user_id }` | All server channels marked read |
| `Error` | `{ message: string }` | Error occurred |

### WebSocket Message Format
```json
{ "op": "Identify", "d": { "token": "eyJ..." } }
```

### WebSocket Auth Flow
1. Connect to `ws://host/ws`
2. Send `Identify` with JWT token as first message
3. Receive `Ready` with `user_id` and `session_id`
4. Server auto-subscribes you to all your server channels
5. Send `Heartbeat` every ~45 seconds
6. Receive `HeartbeatAck` in response
7. If no heartbeat within 90 seconds, server closes connection

---

## 26. Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | `postgres://jolkr:jolkr_dev@localhost:5432/jolkr` | Yes | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Yes | Redis for caching, sessions, rate limits, presence |
| `JWT_SECRET` | — | **Yes** | JWT signing secret (min 32 chars) |
| `NATS_HMAC_SECRET` | — | **Yes** | NATS HMAC signing secret (min 32 chars) |
| `SERVER_PORT` | `8080` | No | HTTP server listen port |
| `MINIO_ENDPOINT` | `http://localhost:9000` | Yes | S3/MinIO endpoint URL |
| `MINIO_ACCESS_KEY` | `jolkr` | Yes | S3/MinIO access key |
| `MINIO_SECRET_KEY` | `jolkr_dev_secret` | Yes | S3/MinIO secret key |
| `MINIO_BUCKET` | `jolkr` | Yes | S3/MinIO bucket name |
| `NATS_URL` | `nats://localhost:4222` | Yes | NATS event bus URL |
| `NATS_USER` | — | No | NATS auth username (optional, but recommended for production) |
| `NATS_PASSWORD` | — | No | NATS auth password (optional, but recommended for production) |
| `VAPID_PRIVATE_KEY` | — | No | Web Push VAPID private key |
| `VAPID_PUBLIC_KEY` | — | No | Web Push VAPID public key (exposed via `/api/push/vapid-key`) |
| `VAPID_SUBJECT` | `mailto:admin@jolkr.app` | No | Web Push subject |
| `SMTP_HOST` | — | No | SMTP server for password reset emails |
| `SMTP_PORT` | `1025` | No | SMTP port |
| `SMTP_FROM` | `noreply@jolkr.app` | No | Email sender address |
| `APP_URL` | `http://localhost/app` | No | Frontend URL (used in reset email links) |
| `CORS_ORIGINS` | `http://localhost:1420, http://localhost, https://tauri.localhost` | No | Comma-separated CORS origins (full URLs with protocol) |
| `RUST_LOG` | `info` | No | Log level filter (e.g., `debug`, `info,sqlx=warn`) |
| `ACCESS_TOKEN_EXPIRY` | — | No | Access token expiry duration |
| `REFRESH_TOKEN_EXPIRY` | — | No | Refresh token expiry duration |
| `ADMIN_SECRET` | — | No | Admin secret for admin-only endpoints (e.g., admin password reset) |
| `API_HOST` | — | No | API server bind host |
| `API_PORT` | — | No | API server bind port |
| `API_WORKERS` | — | No | Number of API worker threads |
| `LOCAL_IP` | — | No | Local IP address for internal networking |
| `PUBLIC_IP` | — | No | Public IP address for external access |
| `MEDIA_HOST` | — | No | Media server bind host |
| `MEDIA_PORT` | — | No | Media server bind port |
| `MINIO_URL` | — | No | MinIO/S3 internal URL (used for presigned URL generation) |
| `REDIS_PASSWORD` | — | No | Redis authentication password |
| `STUN_SERVER` | — | No | STUN server address for WebRTC ICE |
| `MAIL_HOST` | — | No | Mail server hostname (SMTP) |
| `MAIL_PORT` | `587` | No | Mail server port |
| `MAIL_USERNAME` | — | No | Mail server authentication username |
| `MAIL_PASSWORD` | — | No | Mail server authentication password |
| `MAIL_FROM_ADDRESS` | `noreply@jolkr.app` | No | Sender address for outgoing emails |

---

## 27. Database Models

### Core Tables Summary

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | User accounts | id, email, username, display_name, avatar_url, status, bio, password_hash, show_read_receipts |
| `servers` | Server/guild entities | id, name, description, icon_url, banner_url, owner_id, is_public |
| `channels` | Server channels | id, server_id, category_id, name, topic, kind, position, is_nsfw, slowmode_seconds, e2ee_key_generation |
| `categories` | Channel categories | id, server_id, name, position |
| `messages` | Channel messages | id, channel_id, author_id, content, nonce, reply_to_id, thread_id, webhook_id, is_edited, is_pinned |
| `members` | Server membership | id, server_id, user_id, nickname, joined_at |
| `roles` | Server roles | id, server_id, name, color, position, permissions (BIGINT), is_default |
| `member_roles` | Role assignments | member_id, role_id |
| `threads` | Channel threads | id, channel_id, starter_msg_id, name, is_archived |
| `dm_channels` | DM channels | id, is_group, name |
| `dm_members` | DM membership | id, dm_channel_id, user_id |
| `dm_messages` | DM messages | id, dm_channel_id, author_id, content, nonce, is_edited |
| `friendships` | Friend relationships | id, requester_id, addressee_id, status (pending/accepted/blocked) |
| `devices` | Registered devices | id, user_id, device_name, device_type, push_token |
| `sessions` | Auth sessions | id, user_id, device_id, refresh_token_hash, expires_at |
| `user_keys` | E2EE prekeys (X3DH) | id, user_id, device_id, identity_key, signed_prekey, one_time_prekey, is_used |
| `channel_encryption_keys` | Channel E2EE keys | id, channel_id, recipient_user_id, encrypted_key, nonce, key_generation |
| `reactions` | Message reactions | id, message_id, user_id, emoji |
| `pins` | Pinned messages | id, channel_id, message_id, pinned_by |
| `webhooks` | Channel webhooks | id, channel_id, server_id, creator_id, name, avatar_url, token_hash (SHA-256) |
| `invites` | Server invites | id, server_id, creator_id, code, max_uses, use_count, expires_at |
| `polls` | Channel polls | id, message_id, question, duration_seconds |
| `poll_options` | Poll options | id, poll_id, text, position |
| `poll_votes` | Poll votes | id, poll_id, option_id, user_id |
| `channel_read_states` | Channel read tracking | user_id, channel_id, last_read_message_id, updated_at |
| `notification_settings` | Mute/notification prefs | id, user_id, target_type, target_id, muted, mute_until, suppress_everyone |
| `audit_log` | Server audit trail | id, server_id, user_id, action_type, target_id, changes (JSONB), reason |
| `attachments` | Message file attachments | id, message_id, filename, content_type, size_bytes, url |
| `dm_attachments` | DM message file attachments | id, dm_message_id, filename, content_type, size_bytes, url |
| `channel_permission_overwrites` | Channel permission overwrites | id, channel_id, target_type, target_id, allow, deny |
| `dm_message_embeds` | DM message link embeds | id, dm_message_id, url, title, description, image_url |
| `dm_pins` | Pinned DM messages | id, dm_channel_id, message_id, pinned_by |
| `dm_reactions` | DM message reactions | id, dm_message_id, user_id, emoji |
| `message_embeds` | Channel message link embeds | id, message_id, url, title, description, image_url |
| `password_reset_tokens` | Password reset tokens | id, user_id, token_hash, expires_at |
| `email_verification_tokens` | Email verification tokens | id, user_id, token_hash, expires_at, used_at |
| `server_bans` | Server ban records | id, server_id, user_id, banned_by, reason |
| `server_emojis` | Custom server emojis | id, server_id, name, image_url, uploader_id, animated |

---

## 28. Rate Limiting

Distributed rate limiting via Redis with local DashMap fallback. All use token bucket algorithm.

| Endpoint Group | Burst (max tokens) | Refill rate | Notes |
|----------------|---------------------|-------------|-------|
| Auth routes | 5 | 2/sec | Strict — prevents brute force |
| General API | 60 | 30/sec | Default for all authenticated routes |
| Webhook execution | 20 | 10/sec | Per webhook (distributed via Redis) |
| WebSocket messages | 30 | 30/sec | Token bucket per connection |
| Presence query | — | — | Max 100 user IDs per request (hard limit) |

---

## 29. Error Responses

All API errors follow a consistent format:

```json
{
  "error": {
    "code": 400,
    "message": "Descriptive error message"
  }
}
```

| Status Code | Meaning |
|-------------|---------|
| `200` | Success with response body |
| `201` | Created — resource successfully created |
| `204` | Success, no response body |
| `400` | Bad request / validation error |
| `401` | Unauthorized — missing or invalid JWT |
| `403` | Forbidden — insufficient permissions |
| `404` | Resource not found |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `503` | Service unavailable (DB/Redis down) |

---

## 30. Public Endpoints (No Auth)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/avatars/:user_id` | None | Get user avatar (7-day cache) |
| GET | `/api/icons/:server_id` | None | Get server icon (7-day cache) |

These endpoints return cached avatar/icon images with `Cache-Control: max-age=604800` headers.

---

## Infrastructure Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Web Framework | Axum 0.7 (Rust) | Async HTTP server |
| Database | PostgreSQL + sqlx | Persistent data storage |
| Cache | Redis | Sessions, rate limits, presence, token blacklist |
| Event Bus | NATS | Multi-instance pub/sub coordination |
| Object Storage | MinIO (S3-compatible) | Files, avatars, emojis |
| Push Notifications | Web Push (VAPID) | Browser/device notifications |
| Email | SMTP | Password reset emails |
| Metrics | Prometheus | Monitoring via `/metrics` |
| Docker: `jolkr-media` | Media server container | Voice/media SFU service |
| Docker: `nginx` | Nginx reverse proxy | Request routing, static files, SSL termination |
