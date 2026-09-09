//! Voice-authorization token validation (F01).
//!
//! The API server (`jolkr-api`) issues these after checking that a user may
//! access a given channel. The SFU requires one on `Join` and refuses to admit
//! any peer whose token is absent, forged, expired, or bound to a different
//! `(user_id, channel_id)` pair — so knowing a channel UUID is not enough to
//! enter its voice room.
//!
//! Signed with the shared `JWT_SECRET` (HS256), stamped with `typ: "voice"` so
//! it cannot be a replayed access JWT.

use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct VoiceClaims {
    /// User the token was issued to.
    sub: String,
    /// Channel/DM the token authorizes.
    cid: String,
    /// Expiry (validated by the jsonwebtoken crate).
    #[expect(dead_code)]
    exp: u64,
    /// Token kind discriminator — must be `"voice"`.
    typ: String,
}

/// Verify a voice token, requiring it to bind exactly `expected_user` and
/// `expected_channel`. Returns `Ok(())` only when everything checks out;
/// otherwise a short static reason string (for server-side logging only).
pub(crate) fn verify(
    secret: &str,
    token: &str,
    expected_user: Uuid,
    expected_channel: Uuid,
) -> Result<(), &'static str> {
    // Pin HS256 — never let alg negotiation weaken validation.
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.set_required_spec_claims(&["exp"]);

    let data = decode::<VoiceClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|e| {
        use jsonwebtoken::errors::ErrorKind;
        match e.kind() {
            ErrorKind::ExpiredSignature => "token expired",
            _ => "invalid or malformed token",
        }
    })?;

    if data.claims.typ != "voice" {
        return Err("wrong token type");
    }
    if data.claims.sub != expected_user.to_string() {
        return Err("token bound to a different user");
    }
    if data.claims.cid != expected_channel.to_string() {
        return Err("token bound to a different channel");
    }
    Ok(())
}
