use thiserror::Error;

/// Top-level error type shared across all Jolkr crates.
#[derive(Debug, Error)]
pub enum JolkrError {
    /// `NotFound` variant.
    #[error("Resource not found")]
    NotFound,

    /// `Unauthorized` variant.
    #[error("Unauthorized: authentication required")]
    Unauthorized,

    /// `Forbidden` variant.
    #[error("Forbidden: insufficient permissions")]
    Forbidden,

    /// `BadRequest` variant.
    #[error("Bad request: {0}")]
    BadRequest(String),

    /// `Internal` variant.
    #[error("Internal error: {0}")]
    Internal(String),

    /// `Conflict` variant.
    #[error("Conflict: {0}")]
    Conflict(String),

    /// `Database` variant.
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    /// `Validation` variant.
    #[error("Validation error: {0}")]
    Validation(String),

    /// `Jwt` variant.
    #[error("JWT error: {0}")]
    Jwt(String),
}

impl JolkrError {
    /// Returns the HTTP status code that best matches this error variant.
    #[must_use] 
    pub const fn status_code(&self) -> u16 {
        match self {
            Self::NotFound => 404,
            Self::Unauthorized => 401,
            Self::Forbidden => 403,
            Self::BadRequest(_) => 400,
            Self::Validation(_) => 422,
            Self::Conflict(_) => 409,
            Self::Internal(_) => 500,
            Self::Database(_) => 500,
            Self::Jwt(_) => 401,
        }
    }
}
