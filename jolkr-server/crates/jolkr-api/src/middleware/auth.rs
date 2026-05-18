use async_trait::async_trait;
use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use redis::AsyncCommands;
use serde_json::json;
use uuid::Uuid;

use jolkr_core::AuthService;

use crate::routes::AppState;

/// Extractor that reads the `Authorization: Bearer <token>` header, validates the
/// JWT, and makes the authenticated user's ID available to route handlers.
#[derive(Debug, Clone)]
pub(crate) struct AuthUser {
    pub user_id: Uuid,
    #[allow(dead_code)]
    pub device_id: Option<Uuid>,
}

/// Error returned when authentication fails.
pub(crate) enum AuthError {
    Unauthorized(String),
    ServiceUnavailable(String),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AuthError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m),
            AuthError::ServiceUnavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, m),
        };
        let body = json!({
            "error": {
                "code": status.as_u16(),
                "message": message,
            }
        });
        (status, Json(body)).into_response()
    }
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header_value = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AuthError::Unauthorized("Missing Authorization header".into()))?;

        let token = header_value
            .strip_prefix("Bearer ")
            .ok_or_else(|| AuthError::Unauthorized("Invalid Authorization header format".into()))?;

        let claims = AuthService::validate_token(&state.jwt_secret, token)
            .map_err(|e| AuthError::Unauthorized(format!("Invalid token: {e}")))?;

        // Check if this token has been revoked (e.g. via logout). Fail CLOSED on
        // Redis errors — without the blacklist we cannot tell whether the token
        // is still valid, so refuse the request rather than silently honour it.
        let blacklist_key = format!("blacklist:{}", claims.jti);
        let mut conn = state.redis.connection();
        let is_revoked: bool = match conn.exists(&blacklist_key).await {
            Ok(b) => b,
            Err(e) => {
                tracing::error!(error = %e, "Redis blacklist check failed");
                return Err(AuthError::ServiceUnavailable("Auth backend unavailable".into()));
            }
        };
        if is_revoked {
            return Err(AuthError::Unauthorized("Token has been revoked".into()));
        }

        Ok(AuthUser {
            user_id: claims.sub,
            device_id: claims.device_id,
        })
    }
}
