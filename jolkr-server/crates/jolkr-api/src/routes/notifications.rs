use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_db::repo::NotificationSettingRepo;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;
use crate::ws::events::{GatewayEvent, NotificationSettingPayload};

#[derive(Debug, Serialize)]
pub(crate) struct NotificationSettingResponse {
    pub target_type: String,
    pub target_id: Uuid,
    pub muted: bool,
    pub mute_until: Option<DateTime<Utc>>,
    pub suppress_everyone: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct NotificationSettingsListResponse {
    pub settings: Vec<NotificationSettingResponse>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateNotificationSettingRequest {
    pub muted: bool,
    #[serde(default)]
    pub mute_until: Option<DateTime<Utc>>,
    #[serde(default)]
    pub suppress_everyone: bool,
}

/// GET /api/users/me/notifications — list all notification settings
pub(crate) async fn list_notification_settings(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<NotificationSettingsListResponse>, AppError> {
    let rows = NotificationSettingRepo::list_for_user(&state.pool, auth.user_id).await?;
    let settings = rows
        .into_iter()
        .map(|r| NotificationSettingResponse {
            target_type: r.target_type,
            target_id: r.target_id,
            muted: r.muted,
            mute_until: r.mute_until,
            suppress_everyone: r.suppress_everyone,
        })
        .collect();

    Ok(Json(NotificationSettingsListResponse { settings }))
}

/// GET /api/users/me/notifications/:target_type/:target_id
pub(crate) async fn get_notification_setting(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((target_type, target_id)): Path<(String, Uuid)>,
) -> Result<Json<NotificationSettingResponse>, AppError> {
    if target_type != "server" && target_type != "channel" {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "target_type must be 'server' or 'channel'".into(),
        )));
    }

    let row = NotificationSettingRepo::get(&state.pool, auth.user_id, &target_type, target_id).await?;

    match row {
        Some(r) => Ok(Json(NotificationSettingResponse {
            target_type: r.target_type,
            target_id: r.target_id,
            muted: r.muted,
            mute_until: r.mute_until,
            suppress_everyone: r.suppress_everyone,
        })),
        None => Ok(Json(NotificationSettingResponse {
            target_type,
            target_id,
            muted: false,
            mute_until: None,
            suppress_everyone: false,
        })),
    }
}

/// PUT /api/users/me/notifications/:target_type/:target_id
pub(crate) async fn update_notification_setting(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((target_type, target_id)): Path<(String, Uuid)>,
    Json(body): Json<UpdateNotificationSettingRequest>,
) -> Result<Json<NotificationSettingResponse>, AppError> {
    if target_type != "server" && target_type != "channel" {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "target_type must be 'server' or 'channel'".into(),
        )));
    }

    // If unmuting and no other settings, just delete the row
    if !body.muted && !body.suppress_everyone {
        NotificationSettingRepo::delete(&state.pool, auth.user_id, &target_type, target_id).await?;
        let event = GatewayEvent::NotificationSettingUpdate {
            target_type: target_type.clone(),
            target_id,
            setting: None,
        };
        state.nats.publish_to_user(auth.user_id, &event).await;
        return Ok(Json(NotificationSettingResponse {
            target_type,
            target_id,
            muted: false,
            mute_until: None,
            suppress_everyone: false,
        }));
    }

    let row = NotificationSettingRepo::upsert(
        &state.pool,
        auth.user_id,
        &target_type,
        target_id,
        body.muted,
        body.mute_until,
        body.suppress_everyone,
    )
    .await?;

    let event = GatewayEvent::NotificationSettingUpdate {
        target_type: row.target_type.clone(),
        target_id: row.target_id,
        setting: Some(NotificationSettingPayload {
            muted: row.muted,
            mute_until: row.mute_until,
            suppress_everyone: row.suppress_everyone,
        }),
    };
    state.nats.publish_to_user(auth.user_id, &event).await;

    Ok(Json(NotificationSettingResponse {
        target_type: row.target_type,
        target_id: row.target_id,
        muted: row.muted,
        mute_until: row.mute_until,
        suppress_everyone: row.suppress_everyone,
    }))
}
