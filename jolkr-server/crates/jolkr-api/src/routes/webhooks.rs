use axum::{
    extract::{Path, State},
    Json,
};
use dashmap::DashMap;
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

use jolkr_core::services::webhook::{
    CreateWebhookRequest, ExecuteWebhookRequest, UpdateWebhookRequest,
    WebhookInfo, WebhookService,
};
use jolkr_core::services::message::MessageInfo;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

/// Simple per-webhook rate limiter: 5 requests per second.
static WEBHOOK_RATE: std::sync::LazyLock<Arc<DashMap<Uuid, (Instant, u32)>>> =
    std::sync::LazyLock::new(|| {
        let map = Arc::new(DashMap::new());
        // Cleanup stale entries every 60 seconds to prevent unbounded growth
        let map_clone = Arc::clone(&map);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                let now = Instant::now();
                map_clone.retain(|_, (window_start, _)| {
                    now.duration_since(*window_start).as_secs() < 60
                });
            }
        });
        map
    });

fn check_webhook_rate(webhook_id: Uuid) -> bool {
    let now = Instant::now();
    let mut entry = WEBHOOK_RATE.entry(webhook_id).or_insert((now, 0));
    let (ref mut window_start, ref mut count) = *entry;
    if now.duration_since(*window_start).as_secs() >= 1 {
        *window_start = now;
        *count = 1;
        true
    } else if *count < 5 {
        *count += 1;
        true
    } else {
        false
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
    if !check_webhook_rate(webhook_id) {
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
