//! Short-lived bearer-in-the-URL token used for streaming media attachments
//! through `/api/files/:id` from inside `<video src>` / `<audio src>` (where
//! the standard `Authorization: Bearer ...` header is unavailable).
//!
//! Each token is bound to a single attachment ID and the user it was issued
//! to, so leaking it can only ever expose that one file for the remaining
//! window — never the JWT, never another file. Signed with the same
//! `JWT_SECRET` (HS256) but stamped with `typ: "stream"` so a stolen token
//! can't be used as a regular auth header.

use std::time::{SystemTime, UNIX_EPOCH};

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Default lifetime of a stream token. Matches the existing presign expiry
/// so a single page-load round-trip covers the whole playback window.
pub const STREAM_TOKEN_TTL_SECS: u64 = 4 * 3600;

#[derive(Debug, Serialize, Deserialize)]
struct StreamClaims {
    /// Attachment UUID this token grants access to.
    aid: String,
    /// User UUID the token was issued to.
    sub: String,
    /// Unix expiry timestamp (seconds since epoch).
    exp: u64,
    /// Token kind discriminator — must be `"stream"`. Prevents auth JWTs
    /// from being misused as stream tokens and vice versa.
    typ: String,
}

#[derive(Debug, thiserror::Error)]
pub enum StreamTokenError {
    #[error("invalid signature or malformed token")]
    Invalid,
    #[error("token expired")]
    Expired,
    #[error("token bound to a different attachment")]
    WrongAttachment,
    #[error("token has wrong type")]
    WrongType,
    #[error("invalid user id in token")]
    InvalidSubject,
}

/// Sign a stream token for `(attachment_id, user_id)` valid for `ttl_secs`.
pub fn sign(secret: &str, attachment_id: Uuid, user_id: Uuid, ttl_secs: u64) -> Result<String, jsonwebtoken::errors::Error> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let claims = StreamClaims {
        aid: attachment_id.to_string(),
        sub: user_id.to_string(),
        exp: now.saturating_add(ttl_secs),
        typ: "stream".into(),
    };
    encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(secret.as_bytes()))
}

/// Verify a stream token. Returns the user_id on success — caller can use
/// it to enforce per-user access controls (e.g. friend revoked → token
/// becomes useless for that pair on the next access check).
pub fn verify(secret: &str, token: &str, expected_attachment: Uuid) -> Result<Uuid, StreamTokenError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["exp"]);
    let data = decode::<StreamClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|e: jsonwebtoken::errors::Error| {
        use jsonwebtoken::errors::ErrorKind;
        match e.kind() {
            ErrorKind::ExpiredSignature => StreamTokenError::Expired,
            _ => StreamTokenError::Invalid,
        }
    })?;
    if data.claims.typ != "stream" {
        return Err(StreamTokenError::WrongType);
    }
    if data.claims.aid != expected_attachment.to_string() {
        return Err(StreamTokenError::WrongAttachment);
    }
    Uuid::parse_str(&data.claims.sub).map_err(|_| StreamTokenError::InvalidSubject)
}
