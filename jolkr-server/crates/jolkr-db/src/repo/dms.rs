use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{DmAttachmentRow, DmChannelRow, DmMemberRow, DmMessageRow, DmReactionRow};
use jolkr_common::JolkrError;

pub struct DmRepo;

impl DmRepo {
    /// Get or create a 1-on-1 DM channel between two users.
    pub async fn get_or_create_dm(
        pool: &PgPool,
        user_a: Uuid,
        user_b: Uuid,
    ) -> Result<DmChannelRow, JolkrError> {
        let existing = sqlx::query_as::<_, DmChannelRow>(
            r#"SELECT dc.* FROM dm_channels dc
               JOIN dm_members m1 ON m1.dm_channel_id = dc.id AND m1.user_id = $1
               JOIN dm_members m2 ON m2.dm_channel_id = dc.id AND m2.user_id = $2
               WHERE dc.is_group = false"#,
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
            r#"INSERT INTO dm_channels (id, is_group)
               VALUES ($1, false)
               RETURNING *"#,
        )
        .bind(channel_id)
        .fetch_one(pool)
        .await?;

        for user_id in [user_a, user_b] {
            sqlx::query(
                r#"INSERT INTO dm_members (id, dm_channel_id, user_id)
                   VALUES ($1, $2, $3)"#,
            )
            .bind(Uuid::new_v4())
            .bind(channel_id)
            .bind(user_id)
            .execute(pool)
            .await?;
        }

        Ok(channel)
    }

    pub async fn list_dm_channels(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<DmChannelRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DmChannelRow>(
            r#"SELECT dc.* FROM dm_channels dc
               JOIN dm_members m ON m.dm_channel_id = dc.id
               WHERE m.user_id = $1
               ORDER BY dc.updated_at DESC"#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn get_dm_members(
        pool: &PgPool,
        dm_channel_id: Uuid,
    ) -> Result<Vec<DmMemberRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DmMemberRow>(
            r#"SELECT * FROM dm_members WHERE dm_channel_id = $1"#,
        )
        .bind(dm_channel_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn is_member(
        pool: &PgPool,
        dm_channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, JolkrError> {
        let row = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM dm_members
               WHERE dm_channel_id = $1 AND user_id = $2"#,
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
            r#"INSERT INTO dm_channels (id, is_group, name)
               VALUES ($1, true, $2)
               RETURNING *"#,
        )
        .bind(channel_id)
        .bind(name)
        .fetch_one(&mut *tx)
        .await?;

        for &user_id in member_ids {
            sqlx::query(
                r#"INSERT INTO dm_members (id, dm_channel_id, user_id)
                   VALUES ($1, $2, $3)"#,
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
            r#"SELECT * FROM dm_channels WHERE id = $1"#,
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
            r#"INSERT INTO dm_members (id, dm_channel_id, user_id)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING"#,
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
            r#"DELETE FROM dm_members WHERE dm_channel_id = $1 AND user_id = $2"#,
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
            r#"UPDATE dm_channels SET name = $2, updated_at = NOW()
               WHERE id = $1 AND is_group = true
               RETURNING *"#,
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
            r#"SELECT COUNT(*) FROM dm_members WHERE dm_channel_id = $1"#,
        )
        .bind(dm_channel_id)
        .fetch_one(pool)
        .await?;
        Ok(count)
    }

    // ── Messages ─────────────────────────────────────────────────────

    pub async fn send_message(
        pool: &PgPool,
        id: Uuid,
        dm_channel_id: Uuid,
        author_id: Uuid,
        content: Option<&str>,
        encrypted_content: Option<&[u8]>,
        nonce: Option<&[u8]>,
        reply_to_id: Option<Uuid>,
    ) -> Result<DmMessageRow, JolkrError> {
        let row = sqlx::query_as::<_, DmMessageRow>(
            r#"INSERT INTO dm_messages (id, dm_channel_id, author_id, content, encrypted_content, nonce, reply_to_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING *"#,
        )
        .bind(id)
        .bind(dm_channel_id)
        .bind(author_id)
        .bind(content)
        .bind(encrypted_content)
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

    pub async fn get_message(
        pool: &PgPool,
        id: Uuid,
    ) -> Result<DmMessageRow, JolkrError> {
        let row = sqlx::query_as::<_, DmMessageRow>(
            r#"SELECT * FROM dm_messages WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

    pub async fn get_messages(
        pool: &PgPool,
        dm_channel_id: Uuid,
        before: Option<DateTime<Utc>>,
        limit: i64,
    ) -> Result<Vec<DmMessageRow>, JolkrError> {
        let limit = limit.min(100).max(1);
        let before = before.unwrap_or_else(Utc::now);

        let rows = sqlx::query_as::<_, DmMessageRow>(
            r#"SELECT * FROM dm_messages
               WHERE dm_channel_id = $1 AND created_at < $2
               ORDER BY created_at DESC
               LIMIT $3"#,
        )
        .bind(dm_channel_id)
        .bind(before)
        .bind(limit)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn update_message(
        pool: &PgPool,
        id: Uuid,
        content: &str,
    ) -> Result<DmMessageRow, JolkrError> {
        let row = sqlx::query_as::<_, DmMessageRow>(
            r#"UPDATE dm_messages
               SET content = $2, is_edited = true, updated_at = NOW()
               WHERE id = $1
               RETURNING *"#,
        )
        .bind(id)
        .bind(content)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

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
            r#"INSERT INTO dm_attachments (id, dm_message_id, filename, content_type, size_bytes, url)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *"#,
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

    pub async fn list_attachments(
        pool: &PgPool,
        dm_message_id: Uuid,
    ) -> Result<Vec<DmAttachmentRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DmAttachmentRow>(
            r#"SELECT * FROM dm_attachments WHERE dm_message_id = $1 ORDER BY created_at"#,
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
            r#"SELECT * FROM dm_attachments WHERE dm_message_id = ANY($1) ORDER BY created_at"#,
        )
        .bind(message_ids)
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
            r#"SELECT * FROM dm_members WHERE dm_channel_id = ANY($1)"#,
        )
        .bind(channel_ids)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    // ── Reactions ────────────────────────────────────────────────────

    pub async fn add_reaction(
        pool: &PgPool,
        dm_message_id: Uuid,
        user_id: Uuid,
        emoji: &str,
    ) -> Result<DmReactionRow, JolkrError> {
        let row = sqlx::query_as::<_, DmReactionRow>(
            r#"INSERT INTO dm_reactions (id, dm_message_id, user_id, emoji)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (dm_message_id, user_id, emoji) DO NOTHING
               RETURNING *"#,
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

    pub async fn remove_reaction(
        pool: &PgPool,
        dm_message_id: Uuid,
        user_id: Uuid,
        emoji: &str,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            r#"DELETE FROM dm_reactions
               WHERE dm_message_id = $1 AND user_id = $2 AND emoji = $3"#,
        )
        .bind(dm_message_id)
        .bind(user_id)
        .bind(emoji)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn list_reactions(
        pool: &PgPool,
        dm_message_id: Uuid,
    ) -> Result<Vec<DmReactionRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DmReactionRow>(
            r#"SELECT * FROM dm_reactions WHERE dm_message_id = $1 ORDER BY created_at"#,
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
            r#"SELECT * FROM dm_reactions
               WHERE dm_message_id = ANY($1)
               ORDER BY created_at ASC"#,
        )
        .bind(message_ids)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}
