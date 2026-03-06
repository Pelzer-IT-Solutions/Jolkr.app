use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::KeyService;
use jolkr_core::services::key::UploadPreKeysRequest;
use jolkr_db::repo::keys::PreKeyBundle;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

// ── Request / Response types ───────────────────────────────────────────

/// Client sends base64-encoded keys in JSON.
#[derive(Debug, Deserialize)]
pub struct UploadPreKeysBody {
    pub device_id: Uuid,
    /// Base64-encoded Ed25519 public key (32 bytes).
    pub identity_key: String,
    /// Base64-encoded X25519 public key (32 bytes).
    pub signed_prekey: String,
    /// Base64-encoded Ed25519 signature over the signed prekey (64 bytes).
    pub signed_prekey_signature: String,
    /// Base64-encoded one-time X25519 public keys.
    pub one_time_prekeys: Vec<String>,
    /// Base64-encoded ML-KEM-768 encapsulation key (1184 bytes). Optional for PQ hybrid E2EE.
    pub pq_signed_prekey: Option<String>,
    /// Base64-encoded Ed25519 signature over the PQ prekey (64 bytes). Optional.
    pub pq_signed_prekey_signature: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UploadPreKeysResponse {
    pub message: String,
    pub prekey_count: usize,
}

#[derive(Debug, Serialize)]
pub struct PreKeyBundleResponse {
    pub user_id: Uuid,
    pub device_id: Uuid,
    pub identity_key: String,
    pub signed_prekey: String,
    pub signed_prekey_signature: String,
    pub one_time_prekey: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pq_signed_prekey: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pq_signed_prekey_signature: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PreKeyCountResponse {
    pub device_id: Uuid,
    pub remaining: i64,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/keys/upload — Upload prekey bundle for the authenticated user's device.
pub async fn upload_prekeys(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UploadPreKeysBody>,
) -> Result<Json<UploadPreKeysResponse>, AppError> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;

    let identity_key = engine
        .decode(&body.identity_key)
        .map_err(|_| AppError(jolkr_common::JolkrError::Validation("Invalid base64 for identity_key".into())))?;
    let signed_prekey = engine
        .decode(&body.signed_prekey)
        .map_err(|_| AppError(jolkr_common::JolkrError::Validation("Invalid base64 for signed_prekey".into())))?;
    let signed_prekey_signature = engine
        .decode(&body.signed_prekey_signature)
        .map_err(|_| AppError(jolkr_common::JolkrError::Validation("Invalid base64 for signed_prekey_signature".into())))?;

    let mut one_time_prekeys = Vec::with_capacity(body.one_time_prekeys.len());
    for (i, otpk_b64) in body.one_time_prekeys.iter().enumerate() {
        let otpk = engine
            .decode(otpk_b64)
            .map_err(|_| AppError(jolkr_common::JolkrError::Validation(format!("Invalid base64 for one_time_prekey[{i}]"))))?;
        one_time_prekeys.push(otpk);
    }

    let pq_signed_prekey = body.pq_signed_prekey
        .as_ref()
        .map(|b64| engine.decode(b64))
        .transpose()
        .map_err(|_| AppError(jolkr_common::JolkrError::Validation("Invalid base64 for pq_signed_prekey".into())))?;

    let pq_signed_prekey_signature = body.pq_signed_prekey_signature
        .as_ref()
        .map(|b64| engine.decode(b64))
        .transpose()
        .map_err(|_| AppError(jolkr_common::JolkrError::Validation("Invalid base64 for pq_signed_prekey_signature".into())))?;

    let count = one_time_prekeys.len();

    KeyService::upload_prekeys(
        &state.pool,
        auth.user_id,
        UploadPreKeysRequest {
            device_id: body.device_id,
            identity_key,
            signed_prekey,
            signed_prekey_signature,
            one_time_prekeys,
            pq_signed_prekey,
            pq_signed_prekey_signature,
        },
    )
    .await?;

    Ok(Json(UploadPreKeysResponse {
        message: "Prekeys uploaded successfully".into(),
        prekey_count: count,
    }))
}

/// GET /api/keys/:user_id/:device_id — Fetch a prekey bundle for initiating E2EE.
pub async fn get_prekey_bundle(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path((target_user_id, target_device_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<PreKeyBundleResponse>, AppError> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;

    let bundle: PreKeyBundle =
        KeyService::get_prekey_bundle(&state.pool, target_user_id, target_device_id).await?;

    Ok(Json(PreKeyBundleResponse {
        user_id: bundle.user_id,
        device_id: bundle.device_id,
        identity_key: engine.encode(&bundle.identity_key),
        signed_prekey: engine.encode(&bundle.signed_prekey),
        signed_prekey_signature: engine.encode(&bundle.signed_prekey_signature),
        one_time_prekey: bundle.one_time_prekey.map(|k| engine.encode(&k)),
        pq_signed_prekey: bundle.pq_signed_prekey.map(|k| engine.encode(&k)),
        pq_signed_prekey_signature: bundle.pq_signed_prekey_signature.map(|k| engine.encode(&k)),
    }))
}

/// GET /api/keys/:user_id — Fetch a prekey bundle by user_id only (auto-selects device).
pub async fn get_prekey_bundle_by_user(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
) -> Result<Json<PreKeyBundleResponse>, AppError> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;

    let bundle: PreKeyBundle =
        KeyService::get_prekey_bundle_for_user(&state.pool, target_user_id).await?;

    Ok(Json(PreKeyBundleResponse {
        user_id: bundle.user_id,
        device_id: bundle.device_id,
        identity_key: engine.encode(&bundle.identity_key),
        signed_prekey: engine.encode(&bundle.signed_prekey),
        signed_prekey_signature: engine.encode(&bundle.signed_prekey_signature),
        one_time_prekey: bundle.one_time_prekey.map(|k| engine.encode(&k)),
        pq_signed_prekey: bundle.pq_signed_prekey.map(|k| engine.encode(&k)),
        pq_signed_prekey_signature: bundle.pq_signed_prekey_signature.map(|k| engine.encode(&k)),
    }))
}

/// GET /api/keys/count/:device_id — Check remaining one-time prekeys for the authenticated user.
pub async fn get_prekey_count(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(device_id): Path<Uuid>,
) -> Result<Json<PreKeyCountResponse>, AppError> {
    let remaining =
        KeyService::count_remaining_prekeys(&state.pool, auth.user_id, device_id).await?;

    Ok(Json(PreKeyCountResponse {
        device_id,
        remaining,
    }))
}
