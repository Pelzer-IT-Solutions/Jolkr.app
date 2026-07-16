//! Short-lived voice-authorization token (F01).
//!
//! The API server performs the channel-level access check (server-channel
//! membership + `VIEW_CHANNELS`, or DM membership) and, on success, issues one
//! of these tokens bound to a single `(user_id, channel_id)` pair. The client
//! forwards it to the media/SFU server in the `Join` payload; the SFU validates
//! it and refuses to admit peers whose token is absent, forged, expired, or
//! bound to a different user/channel. This is what stops any authenticated user
//! from joining an arbitrary voice room just by knowing its UUID.
//!
//! Signed with the shared `JWT_SECRET` (HS256) — the same secret the media
//! server already holds to validate access JWTs, so no new inter-service secret
//! is required. Stamped with `typ: "voice"` so it can never be replayed as a
//! regular auth JWT (or a `stream` token) and vice versa.

use std::time::{SystemTime, UNIX_EPOCH};

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lifetime of a voice token. Deliberately short: it only needs to cover the
/// round-trip between fetching it and the `Join` handshake completing.
pub(crate) const VOICE_TOKEN_TTL_SECS: u64 = 60;

#[derive(Debug, Serialize, Deserialize)]
struct VoiceClaims {
    /// User UUID the token was issued to.
    sub: String,
    /// Channel (or DM) UUID this token authorizes joining.
    cid: String,
    /// Unix expiry timestamp (seconds since epoch).
    exp: u64,
    /// Token kind discriminator — must be `"voice"`.
    typ: String,
}

/// Sign a voice token for `(user_id, channel_id)` valid for `ttl_secs`.
pub(crate) fn sign(
    secret: &str,
    user_id: Uuid,
    channel_id: Uuid,
    ttl_secs: u64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let claims = VoiceClaims {
        sub: user_id.to_string(),
        cid: channel_id.to_string(),
        exp: now.saturating_add(ttl_secs),
        typ: "voice".into(),
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}
