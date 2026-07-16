//! Voice authorization endpoint (F01).
//!
//! Issues a short-lived HMAC token binding the caller to a specific channel,
//! but only after verifying the caller may actually access that channel. The
//! media/SFU server requires this token on `Join` and fails closed without it,
//! so knowing a channel UUID is no longer sufficient to enter its voice room.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;
use crate::voice_token::{self, VOICE_TOKEN_TTL_SECS};
use crate::ws::handler::can_access_channel;

#[derive(Debug, Deserialize)]
pub(crate) struct VoiceTokenRequest {
    /// Channel or DM UUID the caller wants to join.
    pub channel_id: Uuid,
}

#[derive(Debug, Serialize)]
pub(crate) struct VoiceTokenResponse {
    /// HMAC token to forward to the media server in the `Join` payload.
    pub token: String,
    /// Lifetime in seconds — clients should fetch a fresh token per join.
    pub expires_in: u64,
}

/// POST /api/voice/token — mint a voice-join token for `{ channel_id }`.
///
/// Returns 403 when the caller cannot access the channel (not a member, lacks
/// `VIEW_CHANNELS`, or not a DM participant).
pub(crate) async fn issue_voice_token(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<VoiceTokenRequest>,
) -> Result<Json<VoiceTokenResponse>, AppError> {
    if !can_access_channel(&state, auth.user_id, body.channel_id).await {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    let token = voice_token::sign(
        &state.jwt_secret,
        auth.user_id,
        body.channel_id,
        VOICE_TOKEN_TTL_SECS,
    )
    .map_err(|e| {
        tracing::error!(error = %e, "failed to sign voice token");
        AppError(jolkr_common::JolkrError::Internal(
            "failed to issue voice token".into(),
        ))
    })?;

    Ok(Json(VoiceTokenResponse {
        token,
        expires_in: VOICE_TOKEN_TTL_SECS,
    }))
}
