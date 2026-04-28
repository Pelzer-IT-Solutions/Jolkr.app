use axum::{
    extract::{Path, State},
};
use uuid::Uuid;

use jolkr_db::repo::{DmRepo, UserRepo};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

/// Helper: validate DM membership and return the list of OTHER member ids
/// (i.e. everyone in the conversation except the caller). Works for both
/// 1-on-1 DMs (returns 1 user) and group DMs (returns N-1). The SFU itself
/// has no concept of group vs direct — it just routes by room id (`dm_id`).
async fn validate_dm_call(
    pool: &sqlx::PgPool,
    dm_id: Uuid,
    caller_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    if !DmRepo::is_member(pool, dm_id, caller_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }
    let members = DmRepo::get_dm_members(pool, dm_id).await?;
    let others: Vec<Uuid> = members
        .iter()
        .map(|m| m.user_id)
        .filter(|id| *id != caller_id)
        .collect();
    if others.is_empty() {
        return Err(AppError(jolkr_common::JolkrError::NotFound));
    }
    Ok(others)
}

/// POST /api/dms/:dm_id/call — initiate a call (ring all other members).
pub(crate) async fn initiate_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let others = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let caller = UserRepo::get_by_id(&state.pool, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallRing {
        dm_id,
        caller_id: auth.user_id,
        caller_username: caller.username,
    };
    for uid in others {
        state.nats.publish_to_user(uid, &event).await;
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/dms/:dm_id/call/accept — accept an incoming call. Broadcasts to
/// every member so other sessions/participants stay in sync.
pub(crate) async fn accept_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let others = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallAccept {
        dm_id,
        user_id: auth.user_id,
    };
    for uid in others {
        state.nats.publish_to_user(uid, &event).await;
    }
    state.nats.publish_to_user(auth.user_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/dms/:dm_id/call/reject — reject an incoming call.
pub(crate) async fn reject_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let others = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallReject {
        dm_id,
        user_id: auth.user_id,
    };
    for uid in others {
        state.nats.publish_to_user(uid, &event).await;
    }
    state.nats.publish_to_user(auth.user_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/dms/:dm_id/call/end — end an active call (or hang up before
/// connection). Notifies everyone so dialogs dismiss / sessions disconnect.
pub(crate) async fn end_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let others = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallEnd {
        dm_id,
        user_id: auth.user_id,
    };
    for uid in others {
        state.nats.publish_to_user(uid, &event).await;
    }
    state.nats.publish_to_user(auth.user_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
