use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{DmAttachmentRow, DmChannelRow, DmMemberRow, DmMessageRow, DmPinRow, DmReactionRow};
use jolkr_common::JolkrError;

/// Repository for `dm` persistence.
pub struct DmRepo;

impl DmRepo {
    /// Get or create a 1-on-1 DM channel between two users.
    pub async fn get_or_create_dm(
        pool: &PgPool,
        user_a: Uuid,
        user_b: Uuid,
    ) -> Result<DmChannelRow, JolkrError> {
        let existing = sqlx::query_as::<_, DmChannelRow>(
            "SELECT dc.* FROM dm_channels dc
               JOIN dm_members m1 ON m1.dm_channel_id = dc.id AND m1.user_id = $1
               JOIN dm_members m2 ON m2.dm_channel_id = dc.id AND m2.user_id = $2
               WHERE dc.is_group = false",
        )
        .bind(user_a)
        .bind(user_b)
        .fetch_optional(pool)
        .await?;

        if let Some(channel) = existing {
            return Ok(channel);
        }

        let channel_id = Uuid::new_v4();
        let channel = sqlx::query_as::<_, DmChannelRow>(
            "INSERT INTO dm_channels (id, is_group)
               VALUES ($1, false)
               RETURNING *",
        )
        .bind(channel_id)
        .fetch_one(pool)
        .await?;

        for user_id in [user_a, user_b] {
            sqlx::query(
                "INSERT INTO dm_members (id, dm_channel_id, user_id)
                   VALUES ($1, $2, $3)",
            )
            .bind(Uuid::new_v4())
            .bind(channel_id)
            .bind(user_id)
            .execute(pool)
            .await?;
        }

        Ok(channel)
    }

    /// Lists dm channels.
    pub async fn list_dm_channels(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<DmChannelRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DmChannelRow>(
            "SELECT dc.* FROM dm_channels dc
               JOIN dm_members m ON m.dm_channel_id = dc.id
               WHERE m.user_id = $1 AND m.closed_at IS NULL
               ORDER BY dc.updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Get the last message for each of the given DM channels in a single query.
    /// When `caller_id` is supplied, messages hidden by that user are skipped
    /// so the sidebar preview never shows something the user has hidden.
    pub async fn get_last_messages(
        pool: &PgPool,
        channel_ids: &[Uuid],
    ) -> Result<Vec<DmMessageRow>, JolkrError> {
        Self::get_last_messages_for_user(pool, channel_ids, None).await
    }

    /// Variant of `get_last_messages` that filters out messages the caller has
    /// hidden via `dm_message_hidden_for_user`. Pass `None` to skip the filter.
    pub async fn get_last_messages_for_user(
        pool: &PgPool,
        channel_ids: &[Uuid],
        caller_id: Option<Uuid>,
    ) -> Result<Vec<DmMessageRow>, JolkrError> {
        if channel_ids.is_empty() {
            return Ok(vec![]);
        }
        let rows = sqlx::query_as::<_, DmMessageRow>(
            "SELECT DISTINCT ON (m.dm_channel_id) m.*
               FROM dm_messages m
               LEFT JOIN dm_message_hidden_for_user h
                 ON h.message_id = m.id AND h.user_id = $2
               WHERE m.dm_channel_id = ANY($1)
                 AND ($2::uuid IS NULL OR h.user_id IS NULL)
               ORDER BY m.dm_channel_id, m.created_at DESC",
        )
        .bind(channel_ids)
        .bind(caller_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Mark a DM message as hidden for the given user. Idempotent — repeated
    /// calls are no-ops thanks to the composite primary key.
    pub async fn hide_message_for_user(
        pool: &PgPool,
        message_id: Uuid,
        user_id: Uuid,
        dm_channel_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "INSERT INTO dm_message_hidden_for_user (user_id, message_id, dm_channel_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (user_id, message_id) DO NOTHING",
        )
        .bind(user_id)
        .bind(message_id)
        .bind(dm_channel_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Close (hide) a DM channel for a specific user.
    pub async fn close_dm(
        pool: &PgPool,
        dm_channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "UPDATE dm_members SET closed_at = NOW()
               WHERE dm_channel_id = $1 AND user_id = $2",
        )
        .bind(dm_channel_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Reopen a DM channel for all members (called when a new message arrives).
    pub async fn reopen_dm(
        pool: &PgPool,
        dm_channel_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "UPDATE dm_members SET closed_at = NULL
               WHERE dm_channel_id = $1 AND closed_at IS NOT NULL",
        )
        .bind(dm_channel_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Fetches dm members.
    pub async fn get_dm_members(
        pool: &PgPool,
        dm_channel_id: Uuid,
    ) -> Result<Vec<DmMemberRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DmMemberRow>(
            "SELECT * FROM dm_members WHERE dm_channel_id = $1",
        )
        .bind(dm_channel_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Returns `true` if member.
    pub async fn is_member(
        pool: &PgPool,
        dm_channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, JolkrError> {
        let row = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM dm_members
               WHERE dm_channel_id = $1 AND user_id = $2",
        )
        .bind(dm_channel_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;
        Ok(row > 0)
    }

    // ── Group DM ───────────────────────────────────────────────────────

    /// Create a group DM channel with the given members (atomic).
    pub async fn create_group_dm(
        pool: &PgPool,
        name: Option<&str>,
        member_ids: &[Uuid],
    ) -> Result<DmChannelRow, JolkrError> {
        let mut tx = pool.begin().await?;

        let channel_id = Uuid::new_v4();
        let channel = sqlx::query_as::<_, DmChannelRow>(
            "INSERT INTO dm_channels (id, is_group, name)
               VALUES ($1, true, $2)
               RETURNING *",
        )
        .bind(channel_id)
        .bind(name)
        .fetch_one(&mut *tx)
        .await?;

        for &user_id in member_ids {
            sqlx::query(
                "INSERT INTO dm_members (id, dm_channel_id, user_id)
                   VALUES ($1, $2, $3)",
            )
            .bind(Uuid::new_v4())
            .bind(channel_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        Ok(channel)
    }

    /// Get a single DM channel by ID.
    pub async fn get_channel(
        pool: &PgPool,
        dm_channel_id: Uuid,
    ) -> Result<DmChannelRow, JolkrError> {
        sqlx::query_as::<_, DmChannelRow>(
            "SELECT * FROM dm_channels WHERE id = $1",
        )
        .bind(dm_channel_id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)
    }

    /// Add a member to a DM channel (no-op if already a member).
    pub async fn add_member(
        pool: &PgPool,
        dm_channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "INSERT INTO dm_members (id, dm_channel_id, user_id)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(dm_channel_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Remove a member from a DM channel.
    pub async fn remove_member(
        pool: &PgPool,
        dm_channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "DELETE FROM dm_members WHERE dm_channel_id = $1 AND user_id = $2",
        )
        .bind(dm_channel_id)
        .bind(user_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Update the name of a group DM channel.
    pub async fn update_group_dm(
        pool: &PgPool,
        dm_channel_id: Uuid,
        name: Option<&str>,
    ) -> Result<DmChannelRow, JolkrError> {
        sqlx::query_as::<_, DmChannelRow>(
            "UPDATE dm_channels SET name = $2, updated_at = NOW()
               WHERE id = $1 AND is_group = true
               RETURNING *",
        )
        .bind(dm_channel_id)
        .bind(name)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)
    }

    /// Count members in a DM channel.
    pub async fn count_members(
        pool: &PgPool,
        dm_channel_id: Uuid,
    ) -> Result<i64, JolkrError> {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM dm_members WHERE dm_channel_id = $1",
        )
        .bind(dm_channel_id)
        .fetch_one(pool)
        .await?;
        Ok(count)
    }

    // ── Read Receipts ─────────────────────────────────────────────────

    /// Update the last read message ID for a user in a DM channel.
    pub async fn update_last_read(
        pool: &PgPool,
        dm_channel_id: Uuid,
        user_id: Uuid,
        message_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "UPDATE dm_members SET last_read_message_id = $3
               WHERE dm_channel_id = $1 AND user_id = $2",
        )
        .bind(dm_channel_id)
        .bind(user_id)
        .bind(message_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Get read states (`user_id`, `last_read_message_id`) for all members of a DM channel.
    pub async fn get_read_states(
        pool: &PgPool,
        dm_channel_id: Uuid,
    ) -> Result<Vec<(Uuid, Option<Uuid>)>, JolkrError> {
        let rows = sqlx::query_as::<_, (Uuid, Option<Uuid>)>(
            "SELECT user_id, last_read_message_id FROM dm_members WHERE dm_channel_id = $1",
        )
        .bind(dm_channel_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    // ── Messages ─────────────────────────────────────────────────────

    /// Sends message.
    pub async fn send_message(
        pool: &PgPool,
        id: Uuid,
        dm_channel_id: Uuid,
        author_id: Uuid,
        content: Option<&str>,
        nonce: Option<&[u8]>,
        reply_to_id: Option<Uuid>,
    ) -> Result<DmMessageRow, JolkrError> {
        let row = sqlx::query_as::<_, DmMessageRow>(
            "INSERT INTO dm_messages (id, dm_channel_id, author_id, content, nonce, reply_to_id)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *",
        )
        .bind(id)
        .bind(dm_channel_id)
        .bind(author_id)
        .bind(content)
        .bind(nonce)
        .bind(reply_to_id)
        .fetch_one(pool)
        .await?;

        sqlx::query("UPDATE dm_channels SET updated_at = NOW() WHERE id = $1")
            .bind(dm_channel_id)
            .execute(pool)
            .await?;

        Ok(row)
    }

    /// Fetches message.
    pub async fn get_message(
        pool: &PgPool,
        id: Uuid,
    ) -> Result<DmMessageRow, JolkrError> {
        let row = sqlx::query_as::<_, DmMessageRow>(
            "SELECT * FROM dm_messages WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

    /// Fetches messages, excluding any the caller has hidden for themselves.
    pub async fn get_messages(
        pool: &PgPool,
        dm_channel_id: Uuid,
        caller_id: Uuid,
        before: Option<DateTime<Utc>>,
        limit: i64,
    ) -> Result<Vec<DmMessageRow>, JolkrError> {
        let limit = limit.clamp(1, 100);
        let before = before.unwrap_or_else(Utc::now);

        let rows = sqlx::query_as::<_, DmMessageRow>(
            "SELECT m.* FROM dm_messages m
               LEFT JOIN dm_message_hidden_for_user h
                 ON h.message_id = m.id AND h.user_id = $4
               WHERE m.dm_channel_id = $1
                 AND m.created_at < $2
                 AND h.user_id IS NULL
               ORDER BY m.created_at DESC
               LIMIT $3",
        )
        .bind(dm_channel_id)
        .bind(before)
        .bind(limit)
        .bind(caller_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Updates message.
    pub async fn update_message(
        pool: &PgPool,
        id: Uuid,
        content: &str,
        nonce: Option<&[u8]>,
    ) -> Result<DmMessageRow, JolkrError> {
        let row = sqlx::query_as::<_, DmMessageRow>(
            "UPDATE dm_messages
               SET content = $1, nonce = $2, is_edited = true, updated_at = NOW()
               WHERE id = $3
               RETURNING *",
        )
        .bind(content)
        .bind(nonce)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

    /// Deletes message.
    pub async fn delete_message(
        pool: &PgPool,
        id: Uuid,
    ) -> Result<(), JolkrError> {
        let result = sqlx::query("DELETE FROM dm_messages WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }

    // ── Attachments ──────────────────────────────────────────────────

    /// Creates attachment.
    pub async fn create_attachment(
        pool: &PgPool,
        id: Uuid,
        dm_message_id: Uuid,
        filename: &str,
        content_type: &str,
        size_bytes: i64,
        url: &str,
    ) -> Result<DmAttachmentRow, JolkrError> {
        let row = sqlx::query_as::<_, DmAttachmentRow>(
            "INSERT INTO dm_attachments (id, dm_message_id, filename, content_type, size_bytes, url)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *",
        )
        .bind(id)
        .bind(dm_message_id)
        .bind(filename)
        .bind(content_type)
        .bind(size_bytes)
        .bind(url)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    /// Lists attachments.
    pub async fn list_attachments(
        pool: &PgPool,
        dm_message_id: Uuid,
    ) -> Result<Vec<DmAttachmentRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DmAttachmentRow>(
            "SELECT * FROM dm_attachments WHERE dm_message_id = $1 ORDER BY created_at",
        )
        .bind(dm_message_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Get attachments for multiple DM messages in a single query.
    pub async fn list_attachments_for_messages(
        pool: &PgPool,
        message_ids: &[Uuid],
    ) -> Result<Vec<DmAttachmentRow>, JolkrError> {
        if message_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as::<_, DmAttachmentRow>(
            "SELECT * FROM dm_attachments WHERE dm_message_id = ANY($1) ORDER BY created_at",
        )
        .bind(message_ids)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// List every attachment shared in a DM channel, newest first. Skips
    /// attachments that the caller has hidden via `dm_message_hidden_for_user`
    /// so the "Shared Files" panel respects the same per-user view as the
    /// message list.
    pub async fn list_attachments_for_dm(
        pool: &PgPool,
        dm_channel_id: Uuid,
        caller_id: Uuid,
        limit: i64,
    ) -> Result<Vec<DmAttachmentRow>, JolkrError> {
        let limit = limit.clamp(1, 200);
        let rows = sqlx::query_as::<_, DmAttachmentRow>(
            "SELECT a.*
               FROM dm_attachments a
               JOIN dm_messages m ON m.id = a.dm_message_id
               LEFT JOIN dm_message_hidden_for_user h
                 ON h.message_id = m.id AND h.user_id = $2
               WHERE m.dm_channel_id = $1
                 AND h.user_id IS NULL
               ORDER BY a.created_at DESC
               LIMIT $3",
        )
        .bind(dm_channel_id)
        .bind(caller_id)
        .bind(limit)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Get members for multiple DM channels in a single query.
    pub async fn get_members_for_channels(
        pool: &PgPool,
        channel_ids: &[Uuid],
    ) -> Result<Vec<DmMemberRow>, JolkrError> {
        if channel_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as::<_, DmMemberRow>(
            "SELECT * FROM dm_members WHERE dm_channel_id = ANY($1)",
        )
        .bind(channel_ids)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    // ── Reactions ────────────────────────────────────────────────────

    /// Add reaction.
    pub async fn add_reaction(
        pool: &PgPool,
        dm_message_id: Uuid,
        user_id: Uuid,
        emoji: &str,
    ) -> Result<DmReactionRow, JolkrError> {
        let row = sqlx::query_as::<_, DmReactionRow>(
            "INSERT INTO dm_reactions (id, dm_message_id, user_id, emoji)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (dm_message_id, user_id, emoji) DO NOTHING
               RETURNING *",
        )
        .bind(Uuid::new_v4())
        .bind(dm_message_id)
        .bind(user_id)
        .bind(emoji)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::BadRequest("Reaction already exists".into()))?;
        Ok(row)
    }

    /// Removes reaction.
    pub async fn remove_reaction(
        pool: &PgPool,
        dm_message_id: Uuid,
        user_id: Uuid,
        emoji: &str,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "DELETE FROM dm_reactions
               WHERE dm_message_id = $1 AND user_id = $2 AND emoji = $3",
        )
        .bind(dm_message_id)
        .bind(user_id)
        .bind(emoji)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Lists reactions.
    pub async fn list_reactions(
        pool: &PgPool,
        dm_message_id: Uuid,
    ) -> Result<Vec<DmReactionRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DmReactionRow>(
            "SELECT * FROM dm_reactions WHERE dm_message_id = $1 ORDER BY created_at",
        )
        .bind(dm_message_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Batch load reactions for multiple DM messages.
    pub async fn list_reactions_for_messages(
        pool: &PgPool,
        message_ids: &[Uuid],
    ) -> Result<Vec<DmReactionRow>, JolkrError> {
        if message_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as::<_, DmReactionRow>(
            "SELECT * FROM dm_reactions
               WHERE dm_message_id = ANY($1)
               ORDER BY created_at ASC",
        )
        .bind(message_ids)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    // ── Pins ─────────────────────────────────────────────────────────

    /// Pin a DM message.
    pub async fn pin_message(
        pool: &PgPool,
        dm_channel_id: Uuid,
        message_id: Uuid,
        pinned_by: Uuid,
    ) -> Result<DmPinRow, JolkrError> {
        let row = sqlx::query_as::<_, DmPinRow>(
            "INSERT INTO dm_pins (dm_channel_id, message_id, pinned_by)
               VALUES ($1, $2, $3)
               ON CONFLICT (dm_channel_id, message_id) DO NOTHING
               RETURNING *",
        )
        .bind(dm_channel_id)
        .bind(message_id)
        .bind(pinned_by)
        .fetch_optional(pool)
        .await?;

        // Update the is_pinned flag on the message
        sqlx::query("UPDATE dm_messages SET is_pinned = true WHERE id = $1")
            .bind(message_id)
            .execute(pool)
            .await?;

        // If ON CONFLICT hit, fetch the existing pin
        if let Some(r) = row { Ok(r) } else {
            let existing = sqlx::query_as::<_, DmPinRow>(
                "SELECT * FROM dm_pins WHERE dm_channel_id = $1 AND message_id = $2",
            )
            .bind(dm_channel_id)
            .bind(message_id)
            .fetch_one(pool)
            .await?;
            Ok(existing)
        }
    }

    /// Unpin a DM message.
    pub async fn unpin_message(
        pool: &PgPool,
        dm_channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query("DELETE FROM dm_pins WHERE dm_channel_id = $1 AND message_id = $2")
            .bind(dm_channel_id)
            .bind(message_id)
            .execute(pool)
            .await?;

        sqlx::query("UPDATE dm_messages SET is_pinned = false WHERE id = $1")
            .bind(message_id)
            .execute(pool)
            .await?;

        Ok(())
    }

    /// List pinned messages for a DM channel, ordered by pin time descending.
    pub async fn list_pinned(
        pool: &PgPool,
        dm_channel_id: Uuid,
    ) -> Result<Vec<DmMessageRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DmMessageRow>(
            "SELECT m.* FROM dm_messages m
               INNER JOIN dm_pins p ON p.message_id = m.id
               WHERE p.dm_channel_id = $1
               ORDER BY p.pinned_at DESC",
        )
        .bind(dm_channel_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}
