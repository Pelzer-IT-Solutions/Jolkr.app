use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_db::repo::DeviceRepo;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterDeviceRequest {
    pub device_id: Option<Uuid>,
    pub device_name: String,
    pub device_type: String,
    pub push_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePushTokenRequest {
    pub push_token: String,
}

#[derive(Debug, Serialize)]
pub struct DeviceInfo {
    pub id: Uuid,
    pub device_name: String,
    pub device_type: String,
    pub has_push_token: bool,
    pub last_active_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct DeviceResponse {
    pub device: DeviceInfo,
}

#[derive(Debug, Serialize)]
pub struct DevicesResponse {
    pub devices: Vec<DeviceInfo>,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/devices
pub async fn register_device(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<RegisterDeviceRequest>,
) -> Result<Json<DeviceResponse>, AppError> {
    let device_id = body.device_id.unwrap_or_else(Uuid::new_v4);

    let row = DeviceRepo::upsert(
        &state.pool,
        device_id,
        auth.user_id,
        &body.device_name,
        &body.device_type,
        body.push_token.as_deref(),
    )
    .await?;

    Ok(Json(DeviceResponse {
        device: DeviceInfo {
            id: row.id,
            device_name: row.device_name,
            device_type: row.device_type,
            has_push_token: row.push_token.is_some(),
            last_active_at: row.last_active_at,
            created_at: row.created_at,
        },
    }))
}

/// PATCH /api/devices/:device_id/push-token
pub async fn update_push_token(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(device_id): Path<Uuid>,
    Json(body): Json<UpdatePushTokenRequest>,
) -> Result<Json<DeviceResponse>, AppError> {
    let row = DeviceRepo::update_push_token(
        &state.pool,
        device_id,
        auth.user_id,
        &body.push_token,
    )
    .await?;

    Ok(Json(DeviceResponse {
        device: DeviceInfo {
            id: row.id,
            device_name: row.device_name,
            device_type: row.device_type,
            has_push_token: row.push_token.is_some(),
            last_active_at: row.last_active_at,
            created_at: row.created_at,
        },
    }))
}

/// GET /api/devices
pub async fn list_devices(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<DevicesResponse>, AppError> {
    let rows = DeviceRepo::list_for_user(&state.pool, auth.user_id).await?;

    let devices = rows
        .into_iter()
        .map(|row| DeviceInfo {
            id: row.id,
            device_name: row.device_name,
            device_type: row.device_type,
            has_push_token: row.push_token.is_some(),
            last_active_at: row.last_active_at,
            created_at: row.created_at,
        })
        .collect();

    Ok(Json(DevicesResponse { devices }))
}

/// DELETE /api/devices/:device_id
pub async fn delete_device(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(device_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    DeviceRepo::delete(&state.pool, device_id, auth.user_id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
