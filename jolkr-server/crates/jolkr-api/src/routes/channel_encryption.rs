use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::ChannelEncryptionService;
use jolkr_core::services::channel_encryption::RecipientKey;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

// ── Request / Response types ───────────────────────────────────────────

/// Request body for the E2EE key-distribution endpoints (channel and DM variants).
#[derive(Debug, Deserialize)]
pub(crate) struct DistributeKeysBody {
    /// Monotonically increasing generation counter; clients refuse keys with a lower generation than they've already seen.
    pub key_generation: i32,
    pub recipients: Vec<RecipientKeyBody>,
}

/// Per-recipient encrypted-key payload inside a `DistributeKeysBody`.
#[derive(Debug, Deserialize)]
pub(crate) struct RecipientKeyBody {
    pub user_id: Uuid,
    /// base64-encoded encrypted channel key (same format as DM E2EE payload)
    pub encrypted_key: String,
    /// base64-encoded 12-byte nonce
    pub nonce: String,
}

/// Response body for GET /api/channels/:id/e2ee/my-key and the DM variant.
#[derive(Debug, Serialize)]
pub(crate) struct ChannelKeyResponse {
    /// base64-encoded encrypted channel key (decrypt with the caller's private key).
    pub encrypted_key: String,
    /// base64-encoded 12-byte nonce paired with `encrypted_key`.
    pub nonce: String,
    /// Generation counter of the key being returned.
    pub key_generation: i32,
    /// User who distributed this key (used to fetch the matching public key for verification).
    pub distributor_user_id: Uuid,
}

/// Response body for GET /api/channels/:id/e2ee/generation.
#[derive(Debug, Serialize)]
pub(crate) struct KeyGenerationResponse {
    pub key_generation: i32,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/channels/:id/e2ee/distribute — Distribute encrypted channel keys to members.
pub(crate) async fn distribute_keys(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<DistributeKeysBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Verify membership
    if !ChannelEncryptionService::verify_channel_membership(
        &state.pool,
        channel_id,
        auth.user_id,
    )
    .await?
    {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    let recipients: Vec<RecipientKey> = body
        .recipients
        .into_iter()
        .map(|r| RecipientKey {
            user_id: r.user_id,
            encrypted_key: r.encrypted_key,
            nonce: r.nonce,
        })
        .collect();

    ChannelEncryptionService::distribute_keys(
        &state.pool,
        channel_id,
        auth.user_id,
        body.key_generation,
        recipients,
    )
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /api/channels/:id/e2ee/my-key — Get my encrypted channel key.
pub(crate) async fn get_my_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Option<ChannelKeyResponse>>, AppError> {
    // Verify membership
    if !ChannelEncryptionService::verify_channel_membership(
        &state.pool,
        channel_id,
        auth.user_id,
    )
    .await?
    {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    let key = ChannelEncryptionService::get_my_key(&state.pool, channel_id, auth.user_id).await?;

    Ok(Json(key.map(|k| ChannelKeyResponse {
        encrypted_key: k.encrypted_key,
        nonce: k.nonce,
        key_generation: k.key_generation,
        distributor_user_id: k.distributor_user_id,
    })))
}

// ── DM Channel E2EE Handlers ─────────────────────────────────────────

/// POST /api/dms/:dm_id/e2ee/distribute — Distribute encrypted keys to DM members.
pub(crate) async fn dm_distribute_keys(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<DistributeKeysBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !ChannelEncryptionService::verify_dm_membership(&state.pool, dm_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    let recipients: Vec<RecipientKey> = body
        .recipients
        .into_iter()
        .map(|r| RecipientKey {
            user_id: r.user_id,
            encrypted_key: r.encrypted_key,
            nonce: r.nonce,
        })
        .collect();

    ChannelEncryptionService::distribute_keys(
        &state.pool, dm_id, auth.user_id, body.key_generation, recipients,
    )
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /api/dms/:dm_id/e2ee/my-key — Get my encrypted key for a DM channel.
pub(crate) async fn dm_get_my_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<Option<ChannelKeyResponse>>, AppError> {
    if !ChannelEncryptionService::verify_dm_membership(&state.pool, dm_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    let key = ChannelEncryptionService::get_my_key(&state.pool, dm_id, auth.user_id).await?;

    Ok(Json(key.map(|k| ChannelKeyResponse {
        encrypted_key: k.encrypted_key,
        nonce: k.nonce,
        key_generation: k.key_generation,
        distributor_user_id: k.distributor_user_id,
    })))
}

/// GET /api/channels/:id/e2ee/generation — Get the current key generation.
pub(crate) async fn get_key_generation(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<KeyGenerationResponse>, AppError> {
    // Verify membership
    if !ChannelEncryptionService::verify_channel_membership(
        &state.pool,
        channel_id,
        auth.user_id,
    )
    .await?
    {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    let generation = ChannelEncryptionService::get_key_generation(&state.pool, channel_id).await?;

    Ok(Json(KeyGenerationResponse {
        key_generation: generation,
    }))
}
