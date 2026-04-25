use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_db::models::ReactionRow;
use jolkr_common::Permissions;
use jolkr_db::repo::{ChannelRepo, MemberRepo, MessageRepo, ReactionRepo, RoleRepo};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

#[derive(Serialize)]
pub(crate) struct ReactionsResponse {
    pub reactions: Vec<ReactionRow>,
}

#[derive(Deserialize)]
pub(crate) struct AddReactionRequest {
    pub emoji: String,
}

pub(crate) async fn add_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
    Json(body): Json<AddReactionRequest>,
) -> Result<StatusCode, AppError> {
    // Verify the caller has access to the message's channel
    let msg = MessageRepo::get_by_id(&state.pool, message_id).await?;
    let channel = ChannelRepo::get_by_id(&state.pool, msg.channel_id).await?;
    let member = MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;
    // Check ADD_REACTIONS permission (owner bypasses)
    let server = jolkr_db::repo::ServerRepo::get_by_id(&state.pool, channel.server_id).await?;
    if server.owner_id != auth.user_id {
        let ch_perms = RoleRepo::compute_channel_permissions(
            &state.pool, channel.server_id, msg.channel_id, member.id,
        ).await?;
        if !Permissions::from(ch_perms).has(Permissions::ADD_REACTIONS) {
            return Err(AppError(jolkr_common::JolkrError::Forbidden));
        }
    }

    // Check if member is timed out
    if MemberRepo::is_timed_out(&state.pool, channel.server_id, auth.user_id).await
        .map_err(|e| AppError(e))? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    if body.emoji.len() > 100 {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Emoji must be 100 characters or less".into(),
        )));
    }
    ReactionRepo::add_reaction(&state.pool, message_id, auth.user_id, &body.emoji)
        .await
        .map_err(|e| AppError(e))?;

    // Broadcast aggregated reactions to all channel subscribers
    let rows = ReactionRepo::list_for_message(&state.pool, message_id)
        .await
        .unwrap_or_default();
    {
        use std::collections::HashMap;
        let mut by_emoji: HashMap<String, (i64, Vec<Uuid>)> = HashMap::new();
        for r in rows {
            let entry = by_emoji.entry(r.emoji).or_insert((0, Vec::new()));
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
            channel_id: msg.channel_id,
            message_id,
            reactions,
        };
        state.nats.publish_to_channel(msg.channel_id, &event).await;
    }

    Ok(StatusCode::CREATED)
}

pub(crate) async fn remove_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((message_id, emoji)): Path<(Uuid, String)>,
) -> Result<StatusCode, AppError> {
    // Verify the caller has access to the message's channel
    let msg = MessageRepo::get_by_id(&state.pool, message_id).await?;
    let channel = ChannelRepo::get_by_id(&state.pool, msg.channel_id).await?;
    MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;

    ReactionRepo::remove_reaction(&state.pool, message_id, auth.user_id, &emoji)
        .await
        .map_err(|e| AppError(e))?;

    // Broadcast aggregated reactions to all channel subscribers
    let rows = ReactionRepo::list_for_message(&state.pool, message_id)
        .await
        .unwrap_or_default();
    {
        use std::collections::HashMap;
        let mut by_emoji: HashMap<String, (i64, Vec<Uuid>)> = HashMap::new();
        for r in rows {
            let entry = by_emoji.entry(r.emoji).or_insert((0, Vec::new()));
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
            channel_id: msg.channel_id,
            message_id,
            reactions,
        };
        state.nats.publish_to_channel(msg.channel_id, &event).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn list_reactions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
) -> Result<Json<ReactionsResponse>, AppError> {
    // Verify the caller has access to the message's channel
    let msg = MessageRepo::get_by_id(&state.pool, message_id).await?;
    let channel = ChannelRepo::get_by_id(&state.pool, msg.channel_id).await?;
    MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;

    let reactions = ReactionRepo::list_for_message(&state.pool, message_id)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(ReactionsResponse { reactions }))
}
