/// Application configuration, loaded from environment variables.
#[derive(Debug, Clone)]
pub(crate) struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub server_port: u16,
    pub minio_endpoint: String,
    /// Public-facing URL prefix used to rewrite presigned URLs before they
    /// leave the API. The internal Docker hostname `minio:9000` is unusable
    /// from a browser, so presigned URLs are issued against this URL instead
    /// (signature stays valid because nginx restores Host: minio:9000 on
    /// the way back).
    pub minio_public_url: String,
    pub minio_access_key: String,
    pub minio_secret_key: String,
    pub minio_bucket: String,
    pub nats_url: String,
    pub nats_user: Option<String>,
    pub nats_password: Option<String>,
    pub nats_hmac_secret: String,
    pub vapid_private_key: Option<String>,
    pub vapid_public_key: Option<String>,
    pub vapid_subject: String,
    pub mail_host: Option<String>,
    pub mail_port: u16,
    pub mail_from: String,
    pub mail_username: Option<String>,
    pub mail_password: Option<String>,
    pub app_url: String,
    /// Shared secret guarding admin-only endpoints (password reset). Optional;
    /// when absent, those endpoints reject all requests with 401.
    pub admin_secret: Option<String>,
    /// GIPHY API key for the `/api/gifs/*` proxy. Optional; absence causes
    /// the proxy to return 503 instead of pretending to work.
    pub giphy_api_key: Option<String>,
    /// Base URL of the SFU media server (used by `/health` to ping it).
    pub media_server_url: String,
    /// Comma-separated CORS origins. Empty falls back to localhost dev origins.
    pub cors_origins: Vec<String>,
}

impl Config {
    /// Read config from environment variables with sensible defaults for local development.
    pub(crate) fn from_env() -> Self {
        Self {
            database_url: env_or(
                "DATABASE_URL",
                "postgres://jolkr:jolkr_dev@localhost:5432/jolkr",
            ),
            redis_url: env_or("REDIS_URL", "redis://localhost:6379"),
            jwt_secret: {
                let secret = std::env::var("JWT_SECRET")
                    .expect("FATAL: JWT_SECRET must be set. Refusing to start without it.");
                assert!(secret.len() >= 32, "FATAL: JWT_SECRET is too short ({} chars). Minimum 32 characters required.", secret.len());
                secret
            },
            server_port: env_or("SERVER_PORT", "8080")
                .parse()
                .expect("SERVER_PORT must be a valid u16"),
            minio_endpoint: env_or("MINIO_ENDPOINT", "http://localhost:9000"),
            minio_public_url: env_or("MINIO_PUBLIC_URL", "http://localhost:9000"),
            minio_access_key: env_or("MINIO_ACCESS_KEY", "jolkr"),
            minio_secret_key: env_or("MINIO_SECRET_KEY", "jolkr_dev_secret"),
            minio_bucket: env_or("MINIO_BUCKET", "jolkr"),
            nats_url: env_or("NATS_URL", "nats://localhost:4222"),
            nats_user: std::env::var("NATS_USER").ok(),
            nats_password: std::env::var("NATS_PASSWORD").ok(),
            nats_hmac_secret: {
                let secret = std::env::var("NATS_HMAC_SECRET")
                    .expect("FATAL: NATS_HMAC_SECRET must be set. Refusing to start without it.");
                assert!(secret.len() >= 32, "FATAL: NATS_HMAC_SECRET is too short ({} chars). Minimum 32 characters required.", secret.len());
                secret
            },
            vapid_private_key: std::env::var("VAPID_PRIVATE_KEY").ok(),
            vapid_public_key: std::env::var("VAPID_PUBLIC_KEY").ok(),
            vapid_subject: env_or("VAPID_SUBJECT", "mailto:admin@jolkr.app"),
            mail_host: std::env::var("MAIL_HOST").ok(),
            mail_port: env_or("MAIL_PORT", "587")
                .parse()
                .expect("MAIL_PORT must be a valid u16"),
            mail_from: env_or("MAIL_FROM_ADDRESS", "noreply@jolkr.app"),
            mail_username: std::env::var("MAIL_USERNAME").ok(),
            mail_password: std::env::var("MAIL_PASSWORD").ok(),
            app_url: env_or("APP_URL", "http://localhost/app"),
            admin_secret: {
                let secret = std::env::var("ADMIN_SECRET").ok();
                if let Some(ref v) = secret {
                    if v.len() < 32 {
                        tracing::error!(
                            "ADMIN_SECRET is too short ({} chars). Minimum 32 required for security.",
                            v.len()
                        );
                    }
                }
                secret
            },
            giphy_api_key: std::env::var("GIPHY_API_KEY").ok(),
            media_server_url: env_or("MEDIA_SERVER_URL", "http://jolkr-media:8081"),
            cors_origins: std::env::var("CORS_ORIGINS")
                .ok()
                .map(|s| {
                    s.split(',')
                        .map(|t| t.trim().to_string())
                        .filter(|t| !t.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
        }
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
