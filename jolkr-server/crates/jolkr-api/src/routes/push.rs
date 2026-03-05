use axum::{extract::State, Json};
use serde::Serialize;

use crate::errors::AppError;
use crate::routes::AppState;

#[derive(Serialize)]
pub struct VapidKeyResponse {
    pub public_key: String,
}

/// GET /api/push/vapid-key — returns the VAPID public key for client-side push subscription.
/// No auth required — the public key is public.
pub async fn vapid_key(
    State(state): State<AppState>,
) -> Result<Json<VapidKeyResponse>, AppError> {
    match state.push.vapid_public_key() {
        Some(key) => Ok(Json(VapidKeyResponse {
            public_key: key.to_string(),
        })),
        None => Err(AppError(jolkr_common::JolkrError::Internal(
            "VAPID not configured".into(),
        ))),
    }
}
