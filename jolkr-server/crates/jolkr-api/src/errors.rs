use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use jolkr_common::JolkrError;

/// Wrapper around `JolkrError` that implements Axum's `IntoResponse`.
pub struct AppError(pub JolkrError);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            JolkrError::NotFound => StatusCode::NOT_FOUND,
            JolkrError::Unauthorized => StatusCode::UNAUTHORIZED,
            JolkrError::Forbidden => StatusCode::FORBIDDEN,
            JolkrError::BadRequest(_) => StatusCode::BAD_REQUEST,
            JolkrError::Validation(_) => StatusCode::UNPROCESSABLE_ENTITY,
            JolkrError::Conflict(_) => StatusCode::CONFLICT,
            JolkrError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            JolkrError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
            JolkrError::Jwt(_) => StatusCode::UNAUTHORIZED,
        };

        // H6: Hide internal sqlx error details from clients
        let message = match &self.0 {
            JolkrError::Database(e) => {
                tracing::error!("Database error: {e}");
                "Internal server error".to_string()
            }
            JolkrError::Internal(msg) => {
                tracing::error!("Internal error: {msg}");
                "Internal server error".to_string()
            }
            other => other.to_string(),
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

impl From<JolkrError> for AppError {
    fn from(err: JolkrError) -> Self {
        AppError(err)
    }
}

// Allow `?` on sqlx::Error in handlers
impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError(JolkrError::Database(err))
    }
}
