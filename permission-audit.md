# Permissions & Roles — Complete Overview

## Permission System: Bitfield-Based (u64)

**Backend definition:** `jolkr-server/crates/jolkr-common/src/permissions.rs`
**Frontend mirror:** `jolkr-app/src/utils/permissions.ts`

Both sides use identical `1 << N` bit constants:

| Category | Permission | Bit |
|---|---|---|
| **General** | `ADMINISTRATOR` (bypasses all) | 0 |
| | `VIEW_CHANNELS` | 1 |
| | `MANAGE_CHANNELS` | 2 |
| | `MANAGE_ROLES` | 3 |
| | `MANAGE_SERVER` | 4 |
| **Membership** | `KICK_MEMBERS` | 5 |
| | `BAN_MEMBERS` | 6 |
| | `CREATE_INVITE` | 7 |
| | `CHANGE_NICKNAME` | 8 |
| | `MANAGE_NICKNAMES` | 9 |
| **Text** | `SEND_MESSAGES` | 10 |
| | `EMBED_LINKS` | 11 |
| | `ATTACH_FILES` | 12 |
| | `ADD_REACTIONS` | 13 |
| | `MENTION_EVERYONE` | 14 |
| | `MANAGE_MESSAGES` | 15 |
| | `READ_MESSAGE_HISTORY` | 16 |
| | `USE_EXTERNAL_EMOJIS` | 17 |
| | `SEND_TTS_MESSAGES` | 18 |
| **Voice** | `CONNECT` | 20 |
| | `SPEAK` | 21 |
| | `VIDEO` | 22 |
| | `MUTE_MEMBERS` | 23 |
| | `DEAFEN_MEMBERS` | 24 |
| | `MOVE_MEMBERS` | 25 |
| | `USE_VOICE_ACTIVITY` | 26 |
| | `PRIORITY_SPEAKER` | 27 |
| **Moderation** | `MODERATE_MEMBERS` | 28 |
| | `MANAGE_WEBHOOKS` | 29 |

> **Note:** Bit 19 is unused (gap between text and voice categories).

**Default @everyone permissions:** `VIEW_CHANNELS | SEND_MESSAGES | READ_MESSAGE_HISTORY | EMBED_LINKS | ATTACH_FILES | ADD_REACTIONS | USE_EXTERNAL_EMOJIS | CONNECT | SPEAK | VIDEO | USE_VOICE_ACTIVITY | CHANGE_NICKNAME | CREATE_INVITE`

---

## Database Schema

### `roles` table (`migrations/002_servers.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `server_id` | UUID | FK → servers(id) ON DELETE CASCADE |
| `name` | TEXT | 1-100 chars |
| `color` | INT | RGB as integer, default 0 |
| `position` | INT | Hierarchy (higher = more powerful), default 0 |
| `permissions` | BIGINT | Bitfield, default 0 |
| `is_default` | BOOLEAN | true for @everyone role |
| `created_at` | TIMESTAMPTZ | |

### `member_roles` table (`migrations/002_servers.sql`)

Join table — composite PK on `(member_id, role_id)`.

### `channel_permission_overwrites` table (`migrations/009_channel_overwrites.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `channel_id` | UUID | FK → channels(id) ON DELETE CASCADE |
| `target_type` | TEXT | CHECK: 'role' or 'member' |
| `target_id` | UUID | Polymorphic (role.id or member.id) |
| `allow` | BIGINT | Bitfield, default 0 |
| `deny` | BIGINT | Bitfield, default 0 |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

Unique constraint on `(channel_id, target_type, target_id)`.

---

## Permission Resolution — 3-Layer Model (Discord-style)

Computed in `jolkr-server/crates/jolkr-db/src/repo/roles.rs`.

### Server-Level

1. Start with `@everyone` role permissions
2. Bitwise OR all assigned role permissions
3. **Bypass:** Server owner → ALL permissions
4. **Bypass:** ADMINISTRATOR bit set → ALL permissions

### Channel-Level (applied on top of server-level)

1. If ADMINISTRATOR → return ALL (short-circuit)
2. Apply `@everyone` role overwrite: `(base & !deny) | allow`
3. Aggregate all other role overwrites the member has
4. Apply member-specific overwrite last (highest priority)

**Deny always wins** over unspecified; allow overrides deny at the same layer.

### Batch Computation

- `compute_channel_permissions_for_all_members()` — computes perms for all members at once (avoids N+1)
- `compute_channel_permissions_batch()` — batch compute for a single member across multiple channels

---

## Backend Enforcement

### Auth Middleware (`jolkr-api/src/middleware/auth.rs`)

- JWT validation from `Authorization: Bearer <token>` header
- Redis blacklist check for revoked tokens
- Injects `user_id` and optional `device_id` into handlers
- Returns 401 on failure

### Service Layer (`jolkr-core/src/services/role.rs`)

- `check_permission()` — validates user has specific permission, returns 403 if not
- `get_permissions()` — computes final permission set for a user in a server
- `create_default_role()` — creates @everyone with DEFAULT permissions
- Role CRUD requires `MANAGE_ROLES` or server ownership
- Cannot delete `@everyone` role

### Route-Level Enforcement

Channel permissions computed before sending messages; recipients filtered by `VIEW_CHANNELS` (`routes/messages.rs`).

### API Endpoints

| Method | Path | Required Permission |
|---|---|---|
| `GET` | `/servers/:id/roles` | membership |
| `POST` | `/servers/:id/roles` | MANAGE_ROLES |
| `PATCH` | `/roles/:id` | MANAGE_ROLES |
| `DELETE` | `/roles/:id` | MANAGE_ROLES |
| `PUT` | `/servers/:id/roles/:rid/members` | MANAGE_ROLES |
| `DELETE` | `/servers/:id/roles/:rid/members/:uid` | MANAGE_ROLES |
| `GET` | `/servers/:id/members-with-roles` | membership |
| `GET` | `/servers/:id/permissions/@me` | membership |
| `GET` | `/channels/:id/permissions/@me` | membership |
| `GET` | `/channels/:id/overwrites` | MANAGE_CHANNELS |
| `PUT` | `/channels/:id/overwrites` | MANAGE_ROLES |
| `DELETE` | `/channels/:id/overwrites/:type/:tid` | MANAGE_ROLES |

---

## Frontend Implementation

### Store (`jolkr-app/src/stores/servers.ts`)

| State Key | Type | Purpose |
|---|---|---|
| `permissions` | `Record<serverId, number>` | Cached server-level perms |
| `channelPermissions` | `Record<channelId, number>` | Cached channel-level perms |
| `roles` | `Record<serverId, Role[]>` | Cached roles per server |

- WebSocket events invalidate cache on role/permission changes → auto-refetch on next access

### Permission Gating (`jolkr-app/src/pages/App/useAppMemos.ts`)

- `chanPerms` — uses channel permissions if available, falls back to server permissions
- Derived booleans: `canManageMessages`, `canAddReactions`, `canSendMessages`, `canAttachFiles`, `canManageChannels`, `canEditTheme`
- `inviteableServerIds` — servers where user has `CREATE_INVITE`
- `settingsServerIds` — servers where user can access settings
- Owner + ADMINISTRATOR bypass preserved everywhere
- DMs bypass all permission checks (no permission system in DMs)

### UI Components

| Component | File | What It Gates |
|---|---|---|
| **RolesTab** | `components/dialogs/server-settings/RolesTab.tsx` | Role editor: name, color, permission checkboxes grouped by category |
| **ChannelPermissions** | `components/ChannelPermissions/ChannelPermissions.tsx` | Channel overwrite editor: allow/deny/neutral toggles per permission |
| **ChannelSidebar** | `components/ChannelSidebar/ChannelSidebar.tsx` | Create/edit buttons gated on `canManageChannels` |
| **Message** | `components/Message/Message.tsx` | Pin/delete gated on `MANAGE_MESSAGES`, reactions on `ADD_REACTIONS` |
| **ChatArea** | `components/ChatArea/ChatArea.tsx` | Composer hidden without `SEND_MESSAGES`, attach/GIF hidden without `ATTACH_FILES` |
| **AppShell** | `pages/App/AppShell.tsx` | "Invite to Server" filtered by `CREATE_INVITE` per server |

### API Client (`jolkr-app/src/api/client.ts`)

- `getRoles(serverId)` / `createRole()` / `updateRole()` / `deleteRole()`
- `assignRole()` / `removeRole()`
- `getMembersWithRoles(serverId)`
- `getServerPermissions(serverId)` / `getChannelPermissions(channelId)`
- `listChannelOverwrites()` / `upsertChannelOverwrite()` / `deleteChannelOverwrite()`

---

## Key Design Points

1. **Backend is authoritative** — frontend gates UI for UX but never relies on it for security
2. **Batch computation** avoids N+1 queries (pre-fetch all overwrites per server)
3. **Custom roles start at 0 permissions** — must be explicitly granted
4. **Bit 19 is unused** (gap between text and voice categories)
5. **Overwrite semantics:** `allow` forces true, `deny` forces false, neither = inherit from lower layer
6. **Cannot set both allow and deny** for the same permission on the same overwrite
