use thiserror::Error;

/// Top-level error type shared across all Jolkr crates.
#[derive(Debug, Error)]
pub enum JolkrError {
    #[error("Resource not found")]
    NotFound,

    #[error("Unauthorized: authentication required")]
    Unauthorized,

    #[error("Forbidden: insufficient permissions")]
    Forbidden,

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("JWT error: {0}")]
    Jwt(String),
}

impl JolkrError {
    /// Returns the HTTP status code that best matches this error variant.
    pub fn status_code(&self) -> u16 {
        match self {
            JolkrError::NotFound => 404,
            JolkrError::Unauthorized => 401,
            JolkrError::Forbidden => 403,
            JolkrError::BadRequest(_) => 400,
            JolkrError::Validation(_) => 422,
            JolkrError::Conflict(_) => 409,
            JolkrError::Internal(_) => 500,
            JolkrError::Database(_) => 500,
            JolkrError::Jwt(_) => 401,
        }
    }
}
