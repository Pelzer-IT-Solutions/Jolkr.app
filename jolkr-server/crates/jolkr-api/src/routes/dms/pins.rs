use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use jolkr_core::DmService;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

use super::types::*;

/// POST /api/dms/:dm_id/pins/:message_id — pin a DM message
pub(crate) async fn pin_dm_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((dm_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<DmMessageResponse>, AppError> {
    let message = DmService::pin_message(&state.pool, dm_id, message_id, auth.user_id).await?;

    let event = crate::ws::events::GatewayEvent::MessageUpdate {
        message: dm_to_message_info(&message),
    };
    state.nats.publish_to_channel(dm_id, &event).await;

    Ok(Json(DmMessageResponse { message }))
}

/// DELETE /api/dms/:dm_id/pins/:message_id — unpin a DM message
pub(crate) async fn unpin_dm_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((dm_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<DmMessageResponse>, AppError> {
    let message = DmService::unpin_message(&state.pool, dm_id, message_id, auth.user_id).await?;

    let event = crate::ws::events::GatewayEvent::MessageUpdate {
        message: dm_to_message_info(&message),
    };
    state.nats.publish_to_channel(dm_id, &event).await;

    Ok(Json(DmMessageResponse { message }))
}

/// GET /api/dms/:dm_id/pins — list pinned DM messages
pub(crate) async fn list_dm_pins(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<DmMessagesResponse>, AppError> {
    let messages = DmService::list_pinned(&state.pool, dm_id, auth.user_id).await?;

    Ok(Json(DmMessagesResponse { messages }))
}
