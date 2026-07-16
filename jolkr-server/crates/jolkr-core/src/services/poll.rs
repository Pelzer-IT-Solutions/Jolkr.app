use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use ts_rs::TS;
use uuid::Uuid;
use std::collections::HashMap;

use jolkr_common::JolkrError;
use jolkr_db::repo::{ChannelRepo, MemberRepo, PollRepo};

/// Public information about `polloption`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename = "PollOption")]
pub struct PollOptionInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// Poll identifier.
    pub poll_id: Uuid,
    /// Sort position.
    pub position: i32,
    /// Text.
    pub text: String,
}

/// Public information about `poll`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename = "Poll")]
pub struct PollInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// Referenced message identifier.
    pub message_id: Uuid,
    /// Owning channel identifier.
    pub channel_id: Uuid,
    /// Question.
    pub question: String,
    /// Whether multiple options can be selected.
    pub multi_select: bool,
    /// Whether votes are anonymous.
    pub anonymous: bool,
    /// Expiration timestamp.
    pub expires_at: Option<DateTime<Utc>>,
    /// Options list.
    pub options: Vec<PollOptionInfo>,
    /// Map of `option_id` → vote count
    #[ts(type = "Record<string, number>")]
    pub votes: HashMap<String, i64>,
    /// Current user's voted option IDs
    pub my_votes: Vec<Uuid>,
    /// Total votes.
    #[ts(type = "number")]
    pub total_votes: i64,
    /// Encrypted payload with question + option texts (base64 ciphertext).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub encrypted_payload: Option<String>,
    /// Encryption nonce for `encrypted_payload` (base64).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub nonce: Option<String>,
}

/// Request payload for the `CreatePoll` operation.
///
/// Question and option texts are end-to-end encrypted: the client serializes
/// `{ q, opts }` to JSON and encrypts it with the channel key. The server
/// only learns how many options exist (`option_count`) so it can create the
/// index-based option rows that votes reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePollRequest {
    /// Encrypted `{ q, opts }` payload (base64 ciphertext).
    pub encrypted_payload: String,
    /// Encryption nonce for `encrypted_payload` (base64).
    pub nonce: String,
    /// Number of options inside the encrypted payload.
    pub option_count: u8,
    /// Whether multiple options can be selected.
    pub multi_select: Option<bool>,
    /// Whether votes are anonymous.
    pub anonymous: Option<bool>,
    /// Expiration timestamp.
    pub expires_at: Option<DateTime<Utc>>,
}

/// Request payload for the `Vote` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteRequest {
    /// Option identifier.
    pub option_id: Uuid,
}

/// Domain service for `poll` operations.
pub struct PollService;

impl PollService {
    /// Create a poll — also creates a message in the channel to attach it to.
    #[tracing::instrument(skip(pool, req))]
    pub async fn create_poll(
        pool: &PgPool,
        channel_id: Uuid,
        author_id: Uuid,
        req: CreatePollRequest,
    ) -> Result<(PollInfo, Uuid), JolkrError> {
        // Validate. Texts are ciphertext — only structural checks are possible
        // here. The 16 KiB cap comfortably fits the client-side limits
        // (question ≤ 500 chars + 10 options × 200 chars, encrypted + base64).
        if req.encrypted_payload.trim().is_empty() || req.encrypted_payload.len() > 16_384 {
            return Err(JolkrError::Validation("Encrypted payload must be 1-16384 characters".into()));
        }
        if req.nonce.trim().is_empty() || req.nonce.len() > 64 {
            return Err(JolkrError::Validation("Nonce must be 1-64 characters".into()));
        }
        if req.option_count < 2 || req.option_count > 10 {
            return Err(JolkrError::Validation("Poll must have 2-10 options".into()));
        }

        // Verify the channel exists and user is a member
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        MemberRepo::get_member(pool, channel.server_id, author_id).await.map_err(|e| {
            tracing::warn!(?e, server_id = %channel.server_id, author_id = %author_id, "member lookup failed while creating poll");
            JolkrError::Forbidden
        })?;

        // Create a message for the poll. Static marker only — the question is
        // E2EE and must never leak into the (server-generated) announcement.
        // Nonce stays None: this is a server-side marker, not user content.
        let message_id = Uuid::new_v4();
        jolkr_db::repo::MessageRepo::create_message(
            pool, message_id, channel_id, author_id,
            Some("📊"), None, None,
        ).await?;

        // Create poll — plaintext question column stays empty for E2EE polls.
        let poll_id = Uuid::new_v4();
        let poll = PollRepo::create_poll(
            pool, poll_id, message_id, channel_id,
            "",
            req.multi_select.unwrap_or(false),
            req.anonymous.unwrap_or(false),
            req.expires_at,
            Some(&req.encrypted_payload),
            Some(&req.nonce),
        ).await?;

        // Create index-based option rows with empty text — the real texts
        // live inside the encrypted payload, keyed by position.
        let mut options = Vec::new();
        for i in 0..req.option_count {
            let opt = PollRepo::create_option(pool, Uuid::new_v4(), poll_id, i as i32, "").await?;
            options.push(PollOptionInfo {
                id: opt.id,
                poll_id: opt.poll_id,
                position: opt.position,
                text: opt.text,
            });
        }

        let info = PollInfo {
            id: poll.id,
            message_id: poll.message_id,
            channel_id: poll.channel_id,
            question: poll.question,
            multi_select: poll.multi_select,
            anonymous: poll.anonymous,
            expires_at: poll.expires_at,
            options,
            votes: HashMap::new(),
            my_votes: Vec::new(),
            total_votes: 0,
            encrypted_payload: poll.encrypted_payload,
            nonce: poll.nonce,
        };

        Ok((info, message_id))
    }

    /// Vote on a poll.
    #[tracing::instrument(skip(pool))]
    pub async fn vote(
        pool: &PgPool,
        poll_id: Uuid,
        user_id: Uuid,
        option_id: Uuid,
    ) -> Result<PollInfo, JolkrError> {
        let poll = PollRepo::get_by_id(pool, poll_id).await?;

        // Check expiry
        if let Some(expires) = poll.expires_at {
            if Utc::now() > expires {
                return Err(JolkrError::BadRequest("Poll has expired".into()));
            }
        }

        // Verify user is a member of the channel's server
        let channel = ChannelRepo::get_by_id(pool, poll.channel_id).await?;
        MemberRepo::get_member(pool, channel.server_id, user_id).await.map_err(|e| {
            tracing::warn!(?e, server_id = %channel.server_id, user_id = %user_id, "member lookup failed while voting on poll");
            JolkrError::Forbidden
        })?;

        // H1: Validate option_id belongs to this poll
        let options = PollRepo::list_options(pool, poll_id).await?;
        if !options.iter().any(|o| o.id == option_id) {
            return Err(JolkrError::Validation("Option does not belong to this poll".into()));
        }

        // For single-select, remove existing votes first
        if !poll.multi_select {
            PollRepo::remove_all_user_votes(pool, poll_id, user_id).await?;
        }

        PollRepo::add_vote(pool, poll_id, option_id, user_id).await?;

        Self::get_poll(pool, poll_id, user_id).await
    }

    /// Remove a vote.
    #[tracing::instrument(skip(pool))]
    pub async fn unvote(
        pool: &PgPool,
        poll_id: Uuid,
        user_id: Uuid,
        option_id: Uuid,
    ) -> Result<PollInfo, JolkrError> {
        let poll = PollRepo::get_by_id(pool, poll_id).await?;

        // H7: Check expiry — can't unvote on expired poll
        if let Some(expires) = poll.expires_at {
            if Utc::now() > expires {
                return Err(JolkrError::BadRequest("Poll has expired".into()));
            }
        }

        // H2: Verify user is a member of the channel's server
        let channel = ChannelRepo::get_by_id(pool, poll.channel_id).await?;
        MemberRepo::get_member(pool, channel.server_id, user_id).await.map_err(|e| {
            tracing::warn!(?e, server_id = %channel.server_id, user_id = %user_id, "member lookup failed while unvoting on poll");
            JolkrError::Forbidden
        })?;

        PollRepo::remove_vote(pool, poll_id, option_id, user_id).await?;
        Self::get_poll(pool, poll_id, user_id).await
    }

    /// Get full poll info with vote counts.
    #[tracing::instrument(skip(pool))]
    pub async fn get_poll(
        pool: &PgPool,
        poll_id: Uuid,
        viewer_user_id: Uuid,
    ) -> Result<PollInfo, JolkrError> {
        let poll = PollRepo::get_by_id(pool, poll_id).await?;

        // H3: Verify viewer is a member of the channel's server
        let channel = ChannelRepo::get_by_id(pool, poll.channel_id).await?;
        MemberRepo::get_member(pool, channel.server_id, viewer_user_id).await.map_err(|e| {
            tracing::warn!(?e, server_id = %channel.server_id, viewer_user_id = %viewer_user_id, "member lookup failed while viewing poll");
            JolkrError::Forbidden
        })?;
        let opts = PollRepo::list_options(pool, poll_id).await?;
        let counts = PollRepo::list_vote_counts(pool, poll_id).await?;
        let my_votes = PollRepo::list_user_votes(pool, poll_id, viewer_user_id).await?;

        let mut votes_map = HashMap::new();
        let mut total = 0i64;
        for (opt_id, count) in counts {
            votes_map.insert(opt_id.to_string(), count);
            total += count;
        }

        Ok(PollInfo {
            id: poll.id,
            message_id: poll.message_id,
            channel_id: poll.channel_id,
            question: poll.question,
            multi_select: poll.multi_select,
            anonymous: poll.anonymous,
            expires_at: poll.expires_at,
            options: opts.into_iter().map(|o| PollOptionInfo {
                id: o.id,
                poll_id: o.poll_id,
                position: o.position,
                text: o.text,
            }).collect(),
            votes: votes_map,
            my_votes,
            total_votes: total,
            encrypted_payload: poll.encrypted_payload,
            nonce: poll.nonce,
        })
    }
}
