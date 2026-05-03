/**
 * Zod schemas for runtime validation of API responses.
 *
 * Each schema mirrors a TypeScript interface in `./types.ts`. The two are
 * intentionally kept in sync by hand — the TS interfaces are still the
 * source of truth for component props and store types, while these schemas
 * defend the API boundary against backend drift.
 *
 * Usage from `client.ts`:
 *
 *   const user = await request('/users/me', { method: 'GET' }, { schema: UserSchema })
 *
 * The `schema` option is optional — endpoints that don't pass one keep
 * their previous behavior (no runtime check). Migration is incremental.
 */
import { z } from 'zod'
import type {
  User, Server, Channel, Message, Member, Ban, DmChannel, DmLastMessage,
  Friendship, Invite, TokenPair, Attachment, MessageEmbed, Reaction,
  PreKeyBundleResponse, Role, Category, ChannelOverwrite, Thread,
  ServerEmoji, NotificationSetting, AuditLogEntry, Webhook, Poll, PollOption,
  GifFavorite, ChannelKind, DmFilter, UpdateMeBody,
} from './types'

// ── Helpers ──

/** Trim "?: T | null" by accepting `T | null | undefined`. */
const nullish = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional()

// ── Primitives ──

const DmFilterSchema: z.ZodType<DmFilter> = z.enum(['all', 'friends', 'none'])

const ChannelKindSchema: z.ZodType<ChannelKind> = z.enum(['text', 'voice', 'category'])

// ── User ──

export const UserSchema: z.ZodType<User> = z.object({
  id: z.string(),
  username: z.string(),
  display_name: nullish(z.string()),
  email: nullish(z.string()),
  avatar_url: nullish(z.string()),
  status: nullish(z.string()),
  bio: nullish(z.string()),
  is_online: z.boolean().optional(),
  show_read_receipts: nullish(z.boolean()),
  is_system: z.boolean().optional(),
  email_verified: z.boolean().optional(),
  banner_color: nullish(z.string()),
  dm_filter: nullish(DmFilterSchema),
  allow_friend_requests: nullish(z.boolean()),
  created_at: nullish(z.string()),
})

export const UserArraySchema = z.array(UserSchema)

export const UpdateMeBodySchema: z.ZodType<UpdateMeBody> = z.object({
  username: z.string().optional(),
  display_name: z.string().optional(),
  bio: z.string().optional(),
  avatar_url: z.string().optional(),
  status: nullish(z.string()),
  show_read_receipts: z.boolean().optional(),
  banner_color: z.string().optional(),
  dm_filter: DmFilterSchema.optional(),
  allow_friend_requests: z.boolean().optional(),
})

// ── Server / Channel / Category ──

export const ServerThemeSchema = z.object({
  hue: z.number().nullable(),
  orbs: z.array(z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
    hue: z.number(),
    scale: z.number().optional(),
  })),
})

export const ServerSchema: z.ZodType<Server> = z.object({
  id: z.string(),
  name: z.string(),
  icon_url: nullish(z.string()),
  banner_url: nullish(z.string()),
  owner_id: z.string(),
  description: nullish(z.string()),
  is_public: z.boolean().optional(),
  member_count: z.number().optional(),
  theme: nullish(ServerThemeSchema),
  created_at: nullish(z.string()),
})

export const ServerArraySchema = z.array(ServerSchema)

export const ChannelSchema: z.ZodType<Channel> = z.object({
  id: z.string(),
  server_id: z.string(),
  name: z.string(),
  kind: ChannelKindSchema,
  topic: nullish(z.string()),
  position: z.number(),
  category_id: nullish(z.string()),
  is_nsfw: z.boolean().optional(),
  is_system: z.boolean().optional(),
  slowmode_seconds: z.number().optional(),
  e2ee_key_generation: z.number().optional(),
  created_at: nullish(z.string()),
})

export const ChannelArraySchema = z.array(ChannelSchema)

export const CategorySchema: z.ZodType<Category> = z.object({
  id: z.string(),
  server_id: z.string(),
  name: z.string(),
  position: z.number(),
})

export const CategoryArraySchema = z.array(CategorySchema)

export const ChannelOverwriteSchema: z.ZodType<ChannelOverwrite> = z.object({
  id: z.string(),
  channel_id: z.string(),
  target_type: z.enum(['role', 'member']),
  target_id: z.string(),
  allow: z.number(),
  deny: z.number(),
})

export const ChannelOverwriteArraySchema = z.array(ChannelOverwriteSchema)

// ── Member / Role ──

export const RoleSchema: z.ZodType<Role> = z.object({
  id: z.string(),
  server_id: z.string(),
  name: z.string(),
  color: z.number(),
  position: z.number(),
  permissions: z.number(),
  is_default: z.boolean(),
})

export const RoleArraySchema = z.array(RoleSchema)

export const MemberSchema: z.ZodType<Member> = z.object({
  id: z.string(),
  server_id: z.string(),
  user_id: z.string(),
  nickname: nullish(z.string()),
  joined_at: z.string(),
  timeout_until: nullish(z.string()),
  user: UserSchema.optional(),
  role_ids: z.array(z.string()).optional(),
})

export const MemberArraySchema = z.array(MemberSchema)

// ── Attachment / Embed / Reaction ──

export const AttachmentSchema: z.ZodType<Attachment> = z.object({
  id: z.string(),
  filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
  url: z.string(),
})

export const AttachmentArraySchema = z.array(AttachmentSchema)

export const MessageEmbedSchema: z.ZodType<MessageEmbed> = z.object({
  url: z.string(),
  title: nullish(z.string()),
  description: nullish(z.string()),
  image_url: nullish(z.string()),
  site_name: nullish(z.string()),
  color: nullish(z.string()),
})

export const ReactionSchema: z.ZodType<Reaction> = z.object({
  emoji: z.string(),
  count: z.number(),
  // Backend omits `me` — derived in `stores/messages.ts::transformReactions`.
  me: z.boolean().optional(),
  user_ids: z.array(z.string()).optional(),
})

// ── Poll ──

export const PollOptionSchema: z.ZodType<PollOption> = z.object({
  id: z.string(),
  poll_id: z.string(),
  position: z.number(),
  text: z.string(),
})

export const PollSchema: z.ZodType<Poll> = z.object({
  id: z.string(),
  message_id: z.string(),
  channel_id: z.string(),
  question: z.string(),
  multi_select: z.boolean(),
  anonymous: z.boolean(),
  expires_at: nullish(z.string()),
  options: z.array(PollOptionSchema),
  votes: z.record(z.string(), z.number()),
  my_votes: z.array(z.string()).optional(),
  total_votes: z.number(),
})

// ── Thread ──

export const ThreadSchema: z.ZodType<Thread> = z.object({
  id: z.string(),
  channel_id: z.string(),
  starter_msg_id: nullish(z.string()),
  name: nullish(z.string()),
  is_archived: z.boolean(),
  message_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const ThreadArraySchema = z.array(ThreadSchema)

// ── Message ──

export const MessageSchema: z.ZodType<Message> = z.object({
  id: z.string(),
  channel_id: z.string(),
  author_id: z.string(),
  // Backend serializes attachment-only / pre-content messages with
  // `content: null` (Rust `Option<String>` without skip_serializing_if).
  // Coerce to '' so the rest of the UI can treat it as a string.
  content: z.string().nullish().transform(v => v ?? ''),
  nonce: nullish(z.string()),
  created_at: z.string(),
  updated_at: nullish(z.string()),
  is_edited: z.boolean(),
  is_pinned: z.boolean(),
  reply_to_id: nullish(z.string()),
  thread_id: nullish(z.string()),
  thread_reply_count: nullish(z.number()),
  author: nullish(UserSchema),
  // Vec collections may be omitted, null or empty depending on path. Coerce
  // to `[]` so consumers can iterate without null-guarding.
  attachments: z.array(AttachmentSchema).nullish().transform(v => v ?? []),
  reactions: z.array(ReactionSchema).nullish().transform(v => v ?? []),
  embeds: z.array(MessageEmbedSchema).nullish().transform(v => v ?? []),
  poll: PollSchema.optional(),
  webhook_id: nullish(z.string()),
  webhook_name: nullish(z.string()),
  webhook_avatar: nullish(z.string()),
})

export const MessageArraySchema = z.array(MessageSchema)

// ── DM ──

export const DmLastMessageSchema: z.ZodType<DmLastMessage> = z.object({
  id: z.string(),
  author_id: z.string(),
  content: nullish(z.string()),
  nonce: nullish(z.string()),
  created_at: z.string(),
})

export const DmChannelSchema: z.ZodType<DmChannel> = z.object({
  id: z.string(),
  is_group: z.boolean(),
  name: nullish(z.string()),
  members: z.array(z.string()),
  created_at: z.string(),
  last_message: nullish(DmLastMessageSchema),
})

export const DmChannelArraySchema = z.array(DmChannelSchema)

// ── Friendship / Ban / Invite ──

export const FriendshipSchema: z.ZodType<Friendship> = z.object({
  id: z.string(),
  requester_id: z.string(),
  addressee_id: z.string(),
  status: z.enum(['pending', 'accepted', 'blocked']),
  requester: UserSchema.optional(),
  addressee: UserSchema.optional(),
})

export const FriendshipArraySchema = z.array(FriendshipSchema)

export const BanSchema: z.ZodType<Ban> = z.object({
  id: z.string(),
  server_id: z.string(),
  user_id: z.string(),
  banned_by: nullish(z.string()),
  reason: nullish(z.string()),
  created_at: z.string(),
})

export const BanArraySchema = z.array(BanSchema)

export const InviteSchema: z.ZodType<Invite> = z.object({
  id: z.string(),
  server_id: z.string(),
  code: z.string(),
  creator_id: z.string(),
  max_uses: nullish(z.number()),
  use_count: z.number(),
  expires_at: nullish(z.string()),
})

export const InviteArraySchema = z.array(InviteSchema)

// ── Tokens ──

export const TokenPairSchema: z.ZodType<TokenPair> = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().optional(),
})

/** Backend may return tokens raw or wrapped as { tokens: TokenPair }. */
export const TokenResponseSchema = z.union([
  TokenPairSchema,
  z.object({ tokens: TokenPairSchema }),
])

// ── Misc ──

export const ServerEmojiSchema: z.ZodType<ServerEmoji> = z.object({
  id: z.string(),
  server_id: z.string(),
  name: z.string(),
  image_url: z.string(),
  uploader_id: z.string(),
  animated: z.boolean(),
})

export const ServerEmojiArraySchema = z.array(ServerEmojiSchema)

export const NotificationSettingSchema: z.ZodType<NotificationSetting> = z.object({
  target_type: z.enum(['server', 'channel']),
  target_id: z.string(),
  muted: z.boolean(),
  mute_until: nullish(z.string()),
  suppress_everyone: z.boolean(),
})

export const NotificationSettingArraySchema = z.array(NotificationSettingSchema)

export const AuditLogEntrySchema: z.ZodType<AuditLogEntry> = z.object({
  id: z.string(),
  server_id: z.string(),
  user_id: z.string(),
  action_type: z.string(),
  target_id: nullish(z.string()),
  target_type: nullish(z.string()),
  changes: nullish(z.record(z.string(), z.unknown())),
  reason: nullish(z.string()),
  created_at: z.string(),
})

export const AuditLogEntryArraySchema = z.array(AuditLogEntrySchema)

export const WebhookSchema: z.ZodType<Webhook> = z.object({
  id: z.string(),
  channel_id: z.string(),
  server_id: z.string(),
  creator_id: z.string(),
  name: z.string(),
  avatar_url: nullish(z.string()),
  token: z.string().optional(),
})

export const WebhookArraySchema = z.array(WebhookSchema)

export const PreKeyBundleResponseSchema: z.ZodType<PreKeyBundleResponse> = z.object({
  user_id: z.string(),
  device_id: z.string(),
  identity_key: z.string(),
  signed_prekey: z.string(),
  signed_prekey_signature: z.string(),
  one_time_prekey: nullish(z.string()),
  pq_signed_prekey: nullish(z.string()),
  pq_signed_prekey_signature: nullish(z.string()),
})

export const GifFavoriteSchema: z.ZodType<GifFavorite> = z.object({
  gif_id: z.string(),
  gif_url: z.string(),
  preview_url: z.string(),
  title: z.string(),
  added_at: z.string(),
})

export const GifFavoriteArraySchema = z.array(GifFavoriteSchema)
