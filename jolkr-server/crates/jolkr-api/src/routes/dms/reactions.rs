use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_db::repo::DmRepo;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

/// Request body for POST /api/dms/messages/:id/reactions.
#[derive(Deserialize)]
pub(crate) struct AddReactionRequest {
    /// Unicode emoji or custom-emoji shortcode. Max 100 chars.
    pub emoji: String,
}

/// Response payload for POST /api/dms/messages/:id/reactions.
#[derive(Serialize)]
pub(crate) struct DmReactionResponse {
    pub reaction: DmReactionInfo,
}

/// Response payload for GET /api/dms/messages/:id/reactions.
#[derive(Serialize)]
pub(crate) struct DmReactionsResponse {
    pub reactions: Vec<DmReactionInfo>,
}

/// A single reaction row on a DM message.
#[derive(Serialize)]
pub(crate) struct DmReactionInfo {
    pub id: Uuid,
    pub message_id: Uuid,
    pub user_id: Uuid,
    /// Unicode emoji or custom-emoji shortcode.
    pub emoji: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Aggregate reactions into (emoji → count + user_ids) and broadcast to channel.
async fn broadcast_reactions(state: &AppState, dm_channel_id: Uuid, message_id: Uuid) {
    use std::collections::HashMap;
    let rows = DmRepo::list_reactions(&state.pool, message_id).await.unwrap_or_default();
    let mut by_emoji: HashMap<String, (i64, Vec<Uuid>)> = HashMap::new();
    for r in &rows {
        let entry = by_emoji.entry(r.emoji.clone()).or_insert((0, Vec::new()));
        entry.0 += 1;
        entry.1.push(r.user_id);
    }
    let reactions: Vec<jolkr_core::services::message::ReactionInfo> = by_emoji
        .into_iter()
        .map(|(emoji, (count, user_ids))| jolkr_core::services::message::ReactionInfo {
            emoji,
            count,
            user_ids,
        })
        .collect();
    let event = crate::ws::events::GatewayEvent::ReactionUpdate {
        channel_id: dm_channel_id,
        message_id,
        reactions,
    };
    state.nats.publish_to_channel(dm_channel_id, &event).await;
}

/// POST /api/dms/messages/:id/reactions
pub(crate) async fn add_dm_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
    Json(body): Json<AddReactionRequest>,
) -> Result<Json<DmReactionResponse>, AppError> {
    // Verify the caller is a member of this DM channel
    let msg = DmRepo::get_message(&state.pool, message_id).await?;
    if !DmRepo::is_member(&state.pool, msg.dm_channel_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    if body.emoji.len() > 100 {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Emoji must be 100 characters or less".into(),
        )));
    }
    let row = DmRepo::add_reaction(&state.pool, message_id, auth.user_id, &body.emoji).await?;

    broadcast_reactions(&state, msg.dm_channel_id, message_id).await;

    Ok(Json(DmReactionResponse {
        reaction: DmReactionInfo {
            id: row.id,
            message_id: row.dm_message_id,
            user_id: row.user_id,
            emoji: row.emoji,
            created_at: row.created_at,
        },
    }))
}

/// DELETE /api/dms/messages/:id/reactions/:emoji
pub(crate) async fn remove_dm_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((message_id, emoji)): Path<(Uuid, String)>,
) -> Result<axum::http::StatusCode, AppError> {
    // Verify the caller is a member of this DM channel
    let msg = DmRepo::get_message(&state.pool, message_id).await?;
    if !DmRepo::is_member(&state.pool, msg.dm_channel_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    DmRepo::remove_reaction(&state.pool, message_id, auth.user_id, &emoji).await?;

    broadcast_reactions(&state, msg.dm_channel_id, message_id).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /api/dms/messages/:id/reactions
pub(crate) async fn list_dm_reactions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
) -> Result<Json<DmReactionsResponse>, AppError> {
    // Verify the caller is a member of this DM channel
    let msg = DmRepo::get_message(&state.pool, message_id).await?;
    if !DmRepo::is_member(&state.pool, msg.dm_channel_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    let rows = DmRepo::list_reactions(&state.pool, message_id).await?;
    let reactions = rows
        .into_iter()
        .map(|r| DmReactionInfo {
            id: r.id,
            message_id: r.dm_message_id,
            user_id: r.user_id,
            emoji: r.emoji,
            created_at: r.created_at,
        })
        .collect();
    Ok(Json(DmReactionsResponse { reactions }))
}
