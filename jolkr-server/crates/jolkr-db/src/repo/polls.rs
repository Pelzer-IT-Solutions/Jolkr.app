use sqlx::PgPool;
use uuid::Uuid;
use chrono::{DateTime, Utc};

use crate::models::{PollRow, PollOptionRow, PollVoteRow};
use jolkr_common::JolkrError;

/// Repository for `poll` persistence.
pub struct PollRepo;

impl PollRepo {
    /// Create a poll with options.
    pub async fn create_poll(
        pool: &PgPool,
        id: Uuid,
        message_id: Uuid,
        channel_id: Uuid,
        question: &str,
        multi_select: bool,
        anonymous: bool,
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<PollRow, JolkrError> {
        let poll = sqlx::query_as::<_, PollRow>(
            "
            INSERT INTO polls (id, message_id, channel_id, question, multi_select, anonymous, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            ",
        )
        .bind(id)
        .bind(message_id)
        .bind(channel_id)
        .bind(question)
        .bind(multi_select)
        .bind(anonymous)
        .bind(expires_at)
        .fetch_one(pool)
        .await?;

        Ok(poll)
    }

    /// Add an option to a poll.
    pub async fn create_option(
        pool: &PgPool,
        id: Uuid,
        poll_id: Uuid,
        position: i32,
        text: &str,
    ) -> Result<PollOptionRow, JolkrError> {
        let opt = sqlx::query_as::<_, PollOptionRow>(
            "
            INSERT INTO poll_options (id, poll_id, position, text)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            ",
        )
        .bind(id)
        .bind(poll_id)
        .bind(position)
        .bind(text)
        .fetch_one(pool)
        .await?;

        Ok(opt)
    }

    /// Get a poll by ID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<PollRow, JolkrError> {
        sqlx::query_as::<_, PollRow>("SELECT * FROM polls WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or(JolkrError::NotFound)
    }

    /// Get a poll by `message_id`.
    pub async fn get_by_message_id(pool: &PgPool, message_id: Uuid) -> Result<Option<PollRow>, JolkrError> {
        let poll = sqlx::query_as::<_, PollRow>("SELECT * FROM polls WHERE message_id = $1")
            .bind(message_id)
            .fetch_optional(pool)
            .await?;
        Ok(poll)
    }

    /// Get polls for multiple message IDs (batch).
    pub async fn get_by_message_ids(pool: &PgPool, message_ids: &[Uuid]) -> Result<Vec<PollRow>, JolkrError> {
        if message_ids.is_empty() {
            return Ok(Vec::new());
        }
        let polls = sqlx::query_as::<_, PollRow>("SELECT * FROM polls WHERE message_id = ANY($1)")
            .bind(message_ids)
            .fetch_all(pool)
            .await?;
        Ok(polls)
    }

    /// Get options for a poll.
    pub async fn get_options(pool: &PgPool, poll_id: Uuid) -> Result<Vec<PollOptionRow>, JolkrError> {
        let opts = sqlx::query_as::<_, PollOptionRow>(
            "SELECT * FROM poll_options WHERE poll_id = $1 ORDER BY position ASC"
        )
        .bind(poll_id)
        .fetch_all(pool)
        .await?;
        Ok(opts)
    }

    /// Get options for multiple polls (batch).
    pub async fn get_options_batch(pool: &PgPool, poll_ids: &[Uuid]) -> Result<Vec<PollOptionRow>, JolkrError> {
        if poll_ids.is_empty() {
            return Ok(Vec::new());
        }
        let opts = sqlx::query_as::<_, PollOptionRow>(
            "SELECT * FROM poll_options WHERE poll_id = ANY($1) ORDER BY position ASC"
        )
        .bind(poll_ids)
        .fetch_all(pool)
        .await?;
        Ok(opts)
    }

    /// Add a vote.
    pub async fn add_vote(
        pool: &PgPool,
        poll_id: Uuid,
        option_id: Uuid,
        user_id: Uuid,
    ) -> Result<PollVoteRow, JolkrError> {
        let vote = sqlx::query_as::<_, PollVoteRow>(
            "
            INSERT INTO poll_votes (id, poll_id, option_id, user_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (poll_id, option_id, user_id) DO NOTHING
            RETURNING *
            ",
        )
        .bind(Uuid::new_v4())
        .bind(poll_id)
        .bind(option_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        match vote {
            Some(v) => Ok(v),
            None => Err(JolkrError::Conflict("Already voted for this option".into())),
        }
    }

    /// Remove a vote.
    pub async fn remove_vote(
        pool: &PgPool,
        poll_id: Uuid,
        option_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        let result = sqlx::query(
            "DELETE FROM poll_votes WHERE poll_id = $1 AND option_id = $2 AND user_id = $3"
        )
        .bind(poll_id)
        .bind(option_id)
        .bind(user_id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }

    /// Get vote counts grouped by `option_id`.
    pub async fn get_vote_counts(pool: &PgPool, poll_id: Uuid) -> Result<Vec<(Uuid, i64)>, JolkrError> {
        let counts: Vec<(Uuid, i64)> = sqlx::query_as(
            "SELECT option_id, COUNT(*) as count FROM poll_votes WHERE poll_id = $1 GROUP BY option_id"
        )
        .bind(poll_id)
        .fetch_all(pool)
        .await?;
        Ok(counts)
    }

    /// Get vote counts for multiple polls (batch).
    pub async fn get_vote_counts_batch(pool: &PgPool, poll_ids: &[Uuid]) -> Result<Vec<(Uuid, Uuid, i64)>, JolkrError> {
        if poll_ids.is_empty() {
            return Ok(Vec::new());
        }
        let counts: Vec<(Uuid, Uuid, i64)> = sqlx::query_as(
            "SELECT poll_id, option_id, COUNT(*) as count FROM poll_votes WHERE poll_id = ANY($1) GROUP BY poll_id, option_id"
        )
        .bind(poll_ids)
        .fetch_all(pool)
        .await?;
        Ok(counts)
    }

    /// Get the user's votes for a poll.
    pub async fn get_user_votes(pool: &PgPool, poll_id: Uuid, user_id: Uuid) -> Result<Vec<Uuid>, JolkrError> {
        let votes: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2"
        )
        .bind(poll_id)
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(votes.into_iter().map(|(id,)| id).collect())
    }

    /// Get user votes for multiple polls (batch).
    pub async fn get_user_votes_batch(pool: &PgPool, poll_ids: &[Uuid], user_id: Uuid) -> Result<Vec<(Uuid, Uuid)>, JolkrError> {
        if poll_ids.is_empty() {
            return Ok(Vec::new());
        }
        let votes: Vec<(Uuid, Uuid)> = sqlx::query_as(
            "SELECT poll_id, option_id FROM poll_votes WHERE poll_id = ANY($1) AND user_id = $2"
        )
        .bind(poll_ids)
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(votes)
    }

    /// Remove all votes for a user on a poll (for single-select mode before revoting).
    pub async fn remove_all_user_votes(pool: &PgPool, poll_id: Uuid, user_id: Uuid) -> Result<(), JolkrError> {
        sqlx::query("DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2")
            .bind(poll_id)
            .bind(user_id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
