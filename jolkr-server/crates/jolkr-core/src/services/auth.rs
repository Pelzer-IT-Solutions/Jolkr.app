use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::{info, warn};
use uuid::Uuid;

use jolkr_common::JolkrError;
use jolkr_db::models::UserRow;
use jolkr_db::repo::{PasswordResetRepo, SessionRepo, UserRepo};

// ── Public types ───────────────────────────────────────────────────────

/// JWT claims embedded in every access token.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject: the user ID.
    pub sub: Uuid,
    /// Device ID (if applicable).
    pub device_id: Option<Uuid>,
    /// Issued at (unix timestamp).
    pub iat: i64,
    /// Expiry (unix timestamp).
    pub exp: i64,
}

/// An access + refresh token pair returned after login / register / refresh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

/// Lightweight user DTO returned alongside tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_system: bool,
}

impl From<UserRow> for AuthUser {
    fn from(row: UserRow) -> Self {
        Self {
            id: row.id,
            email: row.email,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            is_system: row.is_system,
        }
    }
}

// ── Service ────────────────────────────────────────────────────────────

pub struct AuthService;

impl AuthService {
    // ── Registration ───────────────────────────────────────────────────

    /// Register a brand-new user account.
    ///
    /// 1. Validates input (email format, username length, password strength).
    /// 2. Hashes the password with Argon2id.
    /// 3. Persists the user row.
    /// 4. Issues a JWT token pair.
    pub async fn register(
        pool: &PgPool,
        jwt_secret: &str,
        email: &str,
        username: &str,
        password: &str,
    ) -> Result<(AuthUser, TokenPair), JolkrError> {
        // -- Input validation --------------------------------------------------
        Self::validate_email(email)?;
        Self::validate_username(username)?;
        Self::validate_password(password)?;

        // -- Check uniqueness (early user-friendly errors) ----------------------
        if UserRepo::get_by_email(pool, email).await.is_ok() {
            return Err(JolkrError::Conflict("Email already in use".into()));
        }
        if UserRepo::get_by_username(pool, username).await.is_ok() {
            return Err(JolkrError::Conflict("Username already taken".into()));
        }

        // -- Hash password with Argon2id ---------------------------------------
        let password_hash = Self::hash_password(password)?;

        // -- Persist user (DB unique constraint catches race conditions) --------
        let user_id = Uuid::new_v4();
        let user_row = UserRepo::create_user(pool, user_id, email, username, &password_hash)
            .await
            .map_err(|e| {
                // Catch unique constraint violations from concurrent registrations
                if let JolkrError::Database(ref db_err) = e {
                    let msg = db_err.to_string();
                    if msg.contains("duplicate key") || msg.contains("unique constraint") || msg.contains("23505") {
                        return JolkrError::Conflict("Email or username already taken".into());
                    }
                }
                e
            })?;
        info!(user_id = %user_id, username = %username, "New user registered");

        // -- Issue tokens -------------------------------------------------------
        let token_pair = Self::issue_tokens(pool, jwt_secret, user_id, None).await?;

        Ok((AuthUser::from(user_row), token_pair))
    }

    // ── Login ──────────────────────────────────────────────────────────

    /// Authenticate with email + password and receive a JWT pair.
    pub async fn login(
        pool: &PgPool,
        jwt_secret: &str,
        email: &str,
        password: &str,
    ) -> Result<(AuthUser, TokenPair), JolkrError> {
        // -- Find user by email ------------------------------------------------
        let user_row = UserRepo::get_by_email(pool, email).await.map_err(|_| {
            warn!(email = %email, "Login attempt for unknown email");
            JolkrError::Unauthorized
        })?;

        // -- Verify password ---------------------------------------------------
        Self::verify_password(password, &user_row.password_hash)?;
        info!(user_id = %user_row.id, "User logged in");

        // -- Issue tokens -------------------------------------------------------
        let token_pair = Self::issue_tokens(pool, jwt_secret, user_row.id, None).await?;

        Ok((AuthUser::from(user_row), token_pair))
    }

    // ── Refresh ────────────────────────────────────────────────────────

    /// Exchange a valid refresh token for a new token pair.
    pub async fn refresh_token(
        pool: &PgPool,
        jwt_secret: &str,
        refresh_token: &str,
    ) -> Result<TokenPair, JolkrError> {
        // Hash the presented refresh token and look up the session
        let token_hash = Self::hash_refresh_token(refresh_token);
        let session = SessionRepo::get_by_token(pool, &token_hash).await?;

        // Invalidate old session (rotate tokens)
        SessionRepo::delete_session(pool, session.id).await?;

        // Issue fresh pair
        let token_pair =
            Self::issue_tokens(pool, jwt_secret, session.user_id, session.device_id).await?;

        info!(user_id = %session.user_id, "Token refreshed");
        Ok(token_pair)
    }

    // ── Password reset ────────────────────────────────────────────────

    /// Admin-only password reset: look up user by email and set a new password.
    pub async fn reset_password(
        pool: &PgPool,
        email: &str,
        new_password: &str,
    ) -> Result<(), JolkrError> {
        Self::validate_password(new_password)?;
        let user = UserRepo::get_by_email(pool, email).await?;
        let hash = Self::hash_password(new_password)?;
        UserRepo::update_password(pool, user.id, &hash).await?;
        info!(user_id = %user.id, "Password reset for user");
        Ok(())
    }

    // ── User-facing password reset ────────────────────────────────────

    /// Generate a password reset token for the given email.
    /// Returns `Some((token, username))` if a user with that email exists,
    /// `None` otherwise. The caller should always return a success response
    /// regardless (no email enumeration).
    pub async fn request_password_reset(
        pool: &PgPool,
        email: &str,
    ) -> Result<Option<(String, String)>, JolkrError> {
        let user = match UserRepo::get_by_email(pool, email).await {
            Ok(u) => u,
            Err(_) => return Ok(None),
        };

        // Delete any existing tokens for this user
        PasswordResetRepo::delete_for_user(pool, user.id).await?;

        // Generate 48 random bytes → base64url token
        let plaintext_token = Self::generate_reset_token();

        // Hash the token for storage (SHA-256)
        let token_hash = Self::hash_reset_token(&plaintext_token);

        // Token expires in 1 hour
        let expires_at = Utc::now() + Duration::hours(1);

        PasswordResetRepo::create(pool, user.id, &token_hash, expires_at).await?;
        info!(user_id = %user.id, "Password reset token generated");

        Ok(Some((plaintext_token, user.username)))
    }

    /// Confirm a password reset: validate token, update password, invalidate sessions.
    pub async fn confirm_password_reset(
        pool: &PgPool,
        token: &str,
        new_password: &str,
    ) -> Result<(), JolkrError> {
        Self::validate_password(new_password)?;

        let token_hash = Self::hash_reset_token(token);
        let reset_row = PasswordResetRepo::get_by_token_hash(pool, &token_hash).await.map_err(|_| {
            warn!("Invalid or expired password reset token used");
            JolkrError::Validation("Invalid or expired reset link".into())
        })?;

        // Hash new password
        let password_hash = Self::hash_password(new_password)?;

        // Update password
        UserRepo::update_password(pool, reset_row.user_id, &password_hash).await?;

        // Mark token as used
        PasswordResetRepo::mark_used(pool, reset_row.id).await?;

        // Delete all remaining tokens for this user
        PasswordResetRepo::delete_for_user(pool, reset_row.user_id).await?;

        // Invalidate all existing sessions (force re-login)
        SessionRepo::delete_all_for_user(pool, reset_row.user_id).await?;

        info!(user_id = %reset_row.user_id, "Password reset confirmed — all sessions invalidated");
        Ok(())
    }

    // ── Token validation ───────────────────────────────────────────────

    /// Validate an access token and return the embedded claims.
    pub fn validate_token(jwt_secret: &str, token: &str) -> Result<Claims, JolkrError> {
        let decoding_key = DecodingKey::from_secret(jwt_secret.as_bytes());
        let mut validation = Validation::new(jsonwebtoken::Algorithm::HS256);
        validation.validate_exp = true;

        let token_data = decode::<Claims>(token, &decoding_key, &validation)
            .map_err(|e| JolkrError::Jwt(e.to_string()))?;

        Ok(token_data.claims)
    }

    // ── Private helpers ────────────────────────────────────────────────

    /// Hash a plaintext password with Argon2id.
    fn hash_password(password: &str) -> Result<String, JolkrError> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| JolkrError::Internal(format!("Password hashing failed: {e}")))?;
        Ok(hash.to_string())
    }

    /// Verify a plaintext password against a stored Argon2 hash.
    fn verify_password(password: &str, hash: &str) -> Result<(), JolkrError> {
        let parsed = PasswordHash::new(hash)
            .map_err(|e| JolkrError::Internal(format!("Invalid stored hash: {e}")))?;
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .map_err(|_| {
                warn!("Password verification failed");
                JolkrError::Unauthorized
            })
    }

    /// Issue an access + refresh token pair and persist the session.
    async fn issue_tokens(
        pool: &PgPool,
        jwt_secret: &str,
        user_id: Uuid,
        device_id: Option<Uuid>,
    ) -> Result<TokenPair, JolkrError> {
        let now = Utc::now();
        let access_exp = now + Duration::hours(1);
        let refresh_exp = now + Duration::days(30);

        // Build access token
        let access_claims = Claims {
            sub: user_id,
            device_id,
            iat: now.timestamp(),
            exp: access_exp.timestamp(),
        };
        let encoding_key = EncodingKey::from_secret(jwt_secret.as_bytes());
        let access_token = encode(&Header::default(), &access_claims, &encoding_key)
            .map_err(|e| JolkrError::Internal(format!("JWT encoding failed: {e}")))?;

        // Build refresh token (random opaque string)
        let refresh_token = Self::generate_refresh_token();
        let refresh_hash = Self::hash_refresh_token(&refresh_token);

        // Persist session
        let session_id = Uuid::new_v4();
        SessionRepo::create_session(pool, session_id, user_id, device_id, &refresh_hash, refresh_exp)
            .await?;

        Ok(TokenPair {
            access_token,
            refresh_token,
            expires_in: 3600, // 1 hour in seconds
        })
    }

    /// Generate a cryptographically random refresh token string.
    fn generate_refresh_token() -> String {
        use base64::Engine;
        use rand::RngCore;
        let mut bytes = [0u8; 48];
        rand::thread_rng().fill_bytes(&mut bytes);
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }

    /// Deterministic hash of a refresh token (for DB lookup).
    fn hash_refresh_token(token: &str) -> String {
        use sha2::{Sha256, Digest};
        let hash = Sha256::digest(token.as_bytes());
        hex::encode(hash)
    }

    /// Generate a cryptographically random password reset token (48 bytes, base64url).
    fn generate_reset_token() -> String {
        use base64::Engine;
        use rand::RngCore;
        let mut bytes = [0u8; 48];
        rand::thread_rng().fill_bytes(&mut bytes);
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }

    /// Hash a reset token with SHA-256 for safe DB storage.
    fn hash_reset_token(token: &str) -> String {
        use sha2::{Sha256, Digest};
        let hash = Sha256::digest(token.as_bytes());
        hex::encode(hash)
    }

    // ── Validators ─────────────────────────────────────────────────────

    fn validate_email(email: &str) -> Result<(), JolkrError> {
        if email.is_empty() {
            return Err(JolkrError::Validation("Email is required".into()));
        }
        if email.len() > 254 {
            return Err(JolkrError::Validation("Email too long".into()));
        }
        // Split on '@' — must have exactly one '@'
        let parts: Vec<&str> = email.split('@').collect();
        if parts.len() != 2 {
            return Err(JolkrError::Validation("Invalid email format".into()));
        }
        let (local, domain) = (parts[0], parts[1]);
        // Local part: non-empty, max 64 chars
        if local.is_empty() || local.len() > 64 {
            return Err(JolkrError::Validation("Invalid email format".into()));
        }
        // Domain: non-empty, must contain a dot, no leading/trailing dots or hyphens
        if domain.is_empty() || !domain.contains('.') {
            return Err(JolkrError::Validation("Invalid email format".into()));
        }
        if domain.starts_with('.') || domain.ends_with('.')
            || domain.starts_with('-') || domain.ends_with('-')
        {
            return Err(JolkrError::Validation("Invalid email format".into()));
        }
        // Domain parts must each be non-empty
        if domain.split('.').any(|p| p.is_empty()) {
            return Err(JolkrError::Validation("Invalid email format".into()));
        }
        // TLD must be at least 2 chars
        if domain.split('.').last().map_or(true, |tld| tld.len() < 2) {
            return Err(JolkrError::Validation("Invalid email format".into()));
        }
        Ok(())
    }

    fn validate_username(username: &str) -> Result<(), JolkrError> {
        if username.len() < 3 {
            return Err(JolkrError::Validation(
                "Username must be at least 3 characters".into(),
            ));
        }
        if username.len() > 32 {
            return Err(JolkrError::Validation(
                "Username must be at most 32 characters".into(),
            ));
        }
        if !username
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        {
            return Err(JolkrError::Validation(
                "Username may only contain letters, digits, underscores, and hyphens".into(),
            ));
        }
        Ok(())
    }

    fn validate_password(password: &str) -> Result<(), JolkrError> {
        if password.len() < 8 {
            return Err(JolkrError::Validation(
                "Password must be at least 8 characters".into(),
            ));
        }
        if password.len() > 128 {
            return Err(JolkrError::Validation(
                "Password must be at most 128 characters".into(),
            ));
        }
        if !password.chars().any(|c| c.is_uppercase()) {
            return Err(JolkrError::Validation(
                "Password must contain at least one uppercase letter".into(),
            ));
        }
        if !password.chars().any(|c| c.is_lowercase()) {
            return Err(JolkrError::Validation(
                "Password must contain at least one lowercase letter".into(),
            ));
        }
        if !password.chars().any(|c| c.is_ascii_digit()) {
            return Err(JolkrError::Validation(
                "Password must contain at least one digit".into(),
            ));
        }
        Ok(())
    }
}
