use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use tracing::info;

use jolkr_core::{AuthService, TokenPair};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// Admin secret for password reset (cached via OnceLock, read from env once)
fn admin_secret() -> Option<&'static String> {
    static ADMIN_SECRET: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    ADMIN_SECRET.get_or_init(|| std::env::var("ADMIN_SECRET").ok()).as_ref()
}

// ── Request / Response types ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub email: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordConfirmRequest {
    pub token: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user: UserDto,
    pub tokens: TokenPair,
}

#[derive(Debug, Serialize)]
pub struct UserDto {
    pub id: String,
    pub email: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_system: bool,
}

#[derive(Debug, Serialize)]
pub struct TokenResponse {
    pub tokens: TokenPair,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/auth/register
pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let (user, tokens) = AuthService::register(
        &state.pool,
        &state.jwt_secret,
        &body.email,
        &body.username,
        &body.password,
    )
    .await?;

    Ok(Json(AuthResponse {
        user: UserDto {
            id: user.id.to_string(),
            email: user.email,
            username: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            is_system: user.is_system,
        },
        tokens,
    }))
}

/// POST /api/auth/login
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let (user, tokens) =
        AuthService::login(&state.pool, &state.jwt_secret, &body.email, &body.password).await?;

    Ok(Json(AuthResponse {
        user: UserDto {
            id: user.id.to_string(),
            email: user.email,
            username: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            is_system: user.is_system,
        },
        tokens,
    }))
}

/// POST /api/auth/reset-password
/// Admin-only endpoint: requires X-Admin-Secret header.
pub async fn reset_password(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<StatusCode, AppError> {
    let secret = admin_secret().ok_or_else(|| {
        AppError(jolkr_common::JolkrError::Unauthorized)
    })?;
    let provided = headers.get("x-admin-secret")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError(jolkr_common::JolkrError::Unauthorized))?;
    // Use constant-time comparison via SHA-256 hashes to prevent timing side-channel attacks.
    use sha2::{Sha256, Digest};
    use subtle::ConstantTimeEq;
    let provided_hash = Sha256::digest(provided.as_bytes());
    let expected_hash = Sha256::digest(secret.as_bytes());
    if provided_hash.ct_eq(&expected_hash).unwrap_u8() != 1 {
        return Err(AppError(jolkr_common::JolkrError::Unauthorized));
    }
    match AuthService::reset_password(&state.pool, &body.email, &body.new_password).await {
        Ok(()) => {
            info!(target_email = %body.email, "Admin password reset executed");
        }
        Err(e) => {
            // Log but return 204 anyway to prevent email enumeration
            info!(target_email = %body.email, error = %e, "Admin password reset failed (user may not exist)");
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/auth/refresh
pub async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> Result<Json<TokenResponse>, AppError> {
    let tokens =
        AuthService::refresh_token(&state.pool, &state.jwt_secret, &body.refresh_token).await?;

    Ok(Json(TokenResponse { tokens }))
}

/// POST /api/auth/forgot-password
/// Always returns 204 regardless of whether the email exists (no email enumeration).
pub async fn forgot_password(
    State(state): State<AppState>,
    Json(body): Json<ForgotPasswordRequest>,
) -> Result<StatusCode, AppError> {
    let result = AuthService::request_password_reset(&state.pool, &body.email).await?;

    if let Some((token, username)) = result {
        let reset_url = format!("{}/forgot-password?token={}", state.app_url, token);
        state.email.send_password_reset(&body.email, &username, &reset_url);
    } else {
        info!(email = %body.email, "Password reset requested for unknown email — ignoring silently");
    }

    // Random delay to prevent timing-based email enumeration
    use rand::Rng;
    let jitter = rand::thread_rng().gen_range(50..200);
    tokio::time::sleep(std::time::Duration::from_millis(jitter)).await;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/auth/reset-password-confirm
/// Validates the reset token and sets a new password.
pub async fn reset_password_confirm(
    State(state): State<AppState>,
    Json(body): Json<ResetPasswordConfirmRequest>,
) -> Result<StatusCode, AppError> {
    AuthService::confirm_password_reset(&state.pool, &body.token, &body.new_password).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/auth/change-password
/// Authenticated endpoint: user changes their own password by providing current + new.
pub async fn change_password(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<StatusCode, AppError> {
    AuthService::change_password(
        &state.pool,
        auth.user_id,
        &body.current_password,
        &body.new_password,
    )
    .await?;
    info!(user_id = %auth.user_id, "User changed their password");
    Ok(StatusCode::NO_CONTENT)
}
