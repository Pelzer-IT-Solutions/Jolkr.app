use axum::{extract::State, http::StatusCode, Json};
use axum::http::HeaderMap;
use chrono::Utc;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use jolkr_core::{AuthService, TokenPair};
use jolkr_db::repo::SessionRepo;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── Account lockout after repeated failed logins ─────────────────────────

const MAX_LOGIN_ATTEMPTS: u64 = 5;
const LOCKOUT_WINDOW_SECS: u64 = 900; // 15 minutes

/// Check if an account is locked out due to too many failed login attempts.
async fn check_login_lockout(state: &AppState, email: &str) -> Result<(), AppError> {
    let key = format!("lockout:{}", email.to_lowercase());
    let mut conn = state.redis.connection();
    let count: u64 = conn.get(&key).await.unwrap_or(0);
    if count >= MAX_LOGIN_ATTEMPTS {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Account temporarily locked due to too many failed login attempts. Try again in 15 minutes.".into(),
        )));
    }
    Ok(())
}

/// Record a failed login attempt in Redis.
async fn record_failed_login(state: &AppState, email: &str) {
    let key = format!("lockout:{}", email.to_lowercase());
    let mut conn = state.redis.connection();
    match conn.incr::<_, _, u64>(&key, 1u64).await {
        Ok(count) => {
            if count == 1 {
                let _ = conn.expire::<_, ()>(&key, LOCKOUT_WINDOW_SECS as i64).await;
            }
        }
        Err(e) => warn!(error = %e, "Failed to record login attempt in Redis"),
    }
}

/// Clear lockout counter on successful login.
async fn clear_login_lockout(state: &AppState, email: &str) {
    let key = format!("lockout:{}", email.to_lowercase());
    let mut conn = state.redis.connection();
    let _ = conn.del::<_, ()>(&key).await;
}

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

#[derive(Debug, Deserialize)]
pub struct LogoutRequest {
    pub refresh_token: String,
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
    // Input validation
    if body.email.len() > 254 {
        return Err(AppError(jolkr_common::JolkrError::Validation("Email too long".into())));
    }
    if body.username.len() > 32 || body.username.len() < 2 {
        return Err(AppError(jolkr_common::JolkrError::Validation("Username must be 2-32 characters".into())));
    }
    if body.password.len() < 8 {
        return Err(AppError(jolkr_common::JolkrError::Validation("Password must be at least 8 characters".into())));
    }
    if body.password.len() > 128 {
        return Err(AppError(jolkr_common::JolkrError::Validation("Password must be 128 characters or less".into())));
    }

    let result = AuthService::register(
        &state.pool,
        &state.jwt_secret,
        &body.email,
        &body.username,
        &body.password,
    )
    .await;

    // Generic error message for conflicts to prevent email/username enumeration
    let (user, tokens) = result.map_err(|e| match &e {
        jolkr_common::JolkrError::Conflict(_) => {
            AppError(jolkr_common::JolkrError::Conflict("Registration failed — email or username may already be in use".into()))
        }
        _ => AppError(e),
    })?;

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
    // Check lockout before attempting authentication
    check_login_lockout(&state, &body.email).await?;

    match AuthService::login(&state.pool, &state.jwt_secret, &body.email, &body.password).await {
        Ok((user, tokens)) => {
            // Success — clear any lockout counter
            clear_login_lockout(&state, &body.email).await;
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
        Err(e) => {
            // Record failed attempt
            record_failed_login(&state, &body.email).await;
            Err(AppError(e))
        }
    }
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

/// POST /api/auth/logout
/// Revokes the current session's refresh token and blacklists the access token.
pub async fn logout(
    auth: AuthUser,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LogoutRequest>,
) -> Result<StatusCode, AppError> {
    // Delete the session (refresh token)
    let token_hash = AuthService::hash_refresh_token_pub(&body.refresh_token);
    if let Ok(session) = SessionRepo::get_by_token(&state.pool, &token_hash).await {
        SessionRepo::delete_session(&state.pool, session.id).await?;
    }

    // Blacklist the current access token's JTI in Redis
    if let Some(token) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        if let Ok(claims) = AuthService::validate_token(&state.jwt_secret, token) {
            let ttl = (claims.exp - Utc::now().timestamp()).max(0) as u64;
            if ttl > 0 {
                let key = format!("blacklist:{}", claims.jti);
                let mut conn = state.redis.connection();
                let _ = conn.set_ex::<_, _, ()>(&key, "1", ttl).await;
            }
        }
    }

    info!(user_id = %auth.user_id, "User logged out");
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/auth/logout-all
/// Revokes ALL sessions for the current user and blacklists the current access token.
pub async fn logout_all(
    auth: AuthUser,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    // Delete all sessions for this user
    SessionRepo::delete_all_for_user(&state.pool, auth.user_id).await?;

    // Blacklist current access token
    if let Some(token) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        if let Ok(claims) = AuthService::validate_token(&state.jwt_secret, token) {
            let ttl = (claims.exp - Utc::now().timestamp()).max(0) as u64;
            if ttl > 0 {
                let key = format!("blacklist:{}", claims.jti);
                let mut conn = state.redis.connection();
                let _ = conn.set_ex::<_, _, ()>(&key, "1", ttl).await;
            }
        }
    }

    info!(user_id = %auth.user_id, "User logged out of all sessions");
    Ok(StatusCode::NO_CONTENT)
}
