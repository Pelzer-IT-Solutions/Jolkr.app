use sqlx::PgPool;
use uuid::Uuid;

use crate::models::ReactionRow;
use jolkr_common::JolkrError;

pub struct ReactionRepo;

impl ReactionRepo {
    pub async fn add_reaction(
        pool: &PgPool,
        message_id: Uuid,
        user_id: Uuid,
        emoji: &str,
    ) -> Result<ReactionRow, JolkrError> {
        let id = Uuid::new_v4();
        let row = sqlx::query_as::<_, ReactionRow>(
            r#"INSERT INTO reactions (id, message_id, user_id, emoji)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (message_id, user_id, emoji) DO UPDATE SET id = reactions.id
               RETURNING *"#,
        )
        .bind(id)
        .bind(message_id)
        .bind(user_id)
        .bind(emoji)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    pub async fn remove_reaction(
        pool: &PgPool,
        message_id: Uuid,
        user_id: Uuid,
        emoji: &str,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            r#"DELETE FROM reactions
               WHERE message_id = $1 AND user_id = $2 AND emoji = $3"#,
        )
        .bind(message_id)
        .bind(user_id)
        .bind(emoji)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn list_for_message(
        pool: &PgPool,
        message_id: Uuid,
    ) -> Result<Vec<ReactionRow>, JolkrError> {
        let rows = sqlx::query_as::<_, ReactionRow>(
            r#"SELECT * FROM reactions
               WHERE message_id = $1
               ORDER BY created_at ASC"#,
        )
        .bind(message_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Batch load reactions for multiple messages.
    pub async fn list_for_messages(
        pool: &PgPool,
        message_ids: &[Uuid],
    ) -> Result<Vec<ReactionRow>, JolkrError> {
        if message_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as::<_, ReactionRow>(
            r#"SELECT * FROM reactions
               WHERE message_id = ANY($1)
               ORDER BY created_at ASC"#,
        )
        .bind(message_ids)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}
