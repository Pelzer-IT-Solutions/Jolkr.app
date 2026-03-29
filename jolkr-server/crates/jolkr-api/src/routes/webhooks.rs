use axum::{
    extract::{Path, State},
    Json,
};
use redis::AsyncCommands;
use serde::Serialize;
use tracing::warn;
use uuid::Uuid;

use jolkr_core::services::webhook::{
    CreateWebhookRequest, ExecuteWebhookRequest, UpdateWebhookRequest,
    WebhookInfo, WebhookService,
};
use jolkr_core::services::message::MessageInfo;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

/// Max webhook executions per second (distributed via Redis).
const WEBHOOK_RATE_LIMIT: u64 = 5;

/// Check webhook rate limit using Redis sliding window.
/// Multi-instance safe: all instances share the same Redis counter.
async fn check_webhook_rate(state: &AppState, webhook_id: Uuid) -> bool {
    let key = format!("rl:webhook:{webhook_id}");
    let mut conn = state.redis.connection();

    match conn.incr::<_, _, u64>(&key, 1u64).await {
        Ok(count) => {
            // Set 1-second expiry on first request in this window
            if count == 1 {
                let _ = conn.expire::<_, ()>(&key, 1).await;
            }
            count <= WEBHOOK_RATE_LIMIT
        }
        Err(e) => {
            warn!(error = %e, webhook_id = %webhook_id, "Redis webhook rate check failed, DENYING request");
            false // fail-closed: block webhooks if Redis is down (they can retry)
        }
    }
}

#[derive(Debug, Serialize)]
pub struct WebhookResponse {
    pub webhook: WebhookInfo,
}

#[derive(Debug, Serialize)]
pub struct WebhooksResponse {
    pub webhooks: Vec<WebhookInfo>,
}

#[derive(Debug, Serialize)]
pub struct WebhookMessageResponse {
    pub message: MessageInfo,
}

/// POST /api/channels/:id/webhooks — create a webhook
pub async fn create_webhook(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreateWebhookRequest>,
) -> Result<Json<WebhookResponse>, AppError> {
    let webhook = WebhookService::create_webhook(&state.pool, channel_id, auth.user_id, body).await?;
    Ok(Json(WebhookResponse { webhook }))
}

/// GET /api/channels/:id/webhooks — list webhooks
pub async fn list_webhooks(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<WebhooksResponse>, AppError> {
    let webhooks = WebhookService::list_webhooks(&state.pool, channel_id, auth.user_id).await?;
    Ok(Json(WebhooksResponse { webhooks }))
}

/// PATCH /api/webhooks/:id — update a webhook
pub async fn update_webhook(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(webhook_id): Path<Uuid>,
    Json(body): Json<UpdateWebhookRequest>,
) -> Result<Json<WebhookResponse>, AppError> {
    let webhook = WebhookService::update_webhook(&state.pool, webhook_id, auth.user_id, body).await?;
    Ok(Json(WebhookResponse { webhook }))
}

/// DELETE /api/webhooks/:id — delete a webhook
pub async fn delete_webhook(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(webhook_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    WebhookService::delete_webhook(&state.pool, webhook_id, auth.user_id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/webhooks/:id/token — regenerate token
pub async fn regenerate_token(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(webhook_id): Path<Uuid>,
) -> Result<Json<WebhookResponse>, AppError> {
    let webhook = WebhookService::regenerate_token(&state.pool, webhook_id, auth.user_id).await?;
    Ok(Json(WebhookResponse { webhook }))
}

/// POST /api/webhooks/:id/:token — execute webhook (unauthenticated)
pub async fn execute_webhook(
    State(state): State<AppState>,
    Path((webhook_id, token)): Path<(Uuid, String)>,
    Json(body): Json<ExecuteWebhookRequest>,
) -> Result<Json<WebhookMessageResponse>, AppError> {
    if !check_webhook_rate(&state, webhook_id).await {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Rate limited: max 5 requests per second per webhook".into(),
        )));
    }

    let message = WebhookService::execute_webhook(&state.pool, webhook_id, &token, body).await?;

    // Publish MessageCreate via NATS
    let event = crate::ws::events::GatewayEvent::MessageCreate {
        message: message.clone(),
    };
    state.nats.publish_to_channel(message.channel_id, &event).await;

    Ok(Json(WebhookMessageResponse { message }))
}
