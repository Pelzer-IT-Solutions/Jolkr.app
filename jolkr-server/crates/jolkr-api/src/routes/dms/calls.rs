use axum::{
    extract::{Path, State},
};
use uuid::Uuid;

use jolkr_db::repo::{DmRepo, UserRepo};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

/// Helper: validate DM membership, ensure it's a 1-on-1 DM, return the other member's user_id.
async fn validate_dm_call(
    pool: &sqlx::PgPool,
    dm_id: Uuid,
    caller_id: Uuid,
) -> Result<Uuid, AppError> {
    let channel = DmRepo::get_channel(pool, dm_id).await?;
    if channel.is_group {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Voice calls are only supported in 1-on-1 DMs".into(),
        )));
    }
    if !DmRepo::is_member(pool, dm_id, caller_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }
    let members = DmRepo::get_dm_members(pool, dm_id).await?;
    let other_id = members
        .iter()
        .find(|m| m.user_id != caller_id)
        .map(|m| m.user_id)
        .ok_or(AppError(jolkr_common::JolkrError::NotFound))?;
    Ok(other_id)
}

/// POST /api/dms/:dm_id/call — initiate a call (ring the other user).
pub(crate) async fn initiate_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let other_id = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let caller = UserRepo::get_by_id(&state.pool, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallRing {
        dm_id,
        caller_id: auth.user_id,
        caller_username: caller.username,
    };
    state.nats.publish_to_user(other_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/dms/:dm_id/call/accept — accept an incoming call.
pub(crate) async fn accept_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let other_id = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallAccept {
        dm_id,
        user_id: auth.user_id,
    };
    // Broadcast to both users so all sessions sync
    state.nats.publish_to_user(other_id, &event).await;
    state.nats.publish_to_user(auth.user_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/dms/:dm_id/call/reject — reject an incoming call.
pub(crate) async fn reject_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let other_id = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallReject {
        dm_id,
        user_id: auth.user_id,
    };
    // Broadcast to both users so all sessions sync
    state.nats.publish_to_user(other_id, &event).await;
    state.nats.publish_to_user(auth.user_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/dms/:dm_id/call/end — end an active call.
pub(crate) async fn end_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let other_id = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallEnd {
        dm_id,
        user_id: auth.user_id,
    };
    // Broadcast to both users so all sessions sync
    state.nats.publish_to_user(other_id, &event).await;
    state.nats.publish_to_user(auth.user_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
