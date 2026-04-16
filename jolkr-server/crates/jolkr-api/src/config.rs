/// Application configuration, loaded from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub server_port: u16,
    pub minio_endpoint: String,
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
}

impl Config {
    /// Read config from environment variables with sensible defaults for local development.
    pub fn from_env() -> Self {
        Self {
            database_url: env_or(
                "DATABASE_URL",
                "postgres://jolkr:jolkr_dev@localhost:5432/jolkr",
            ),
            redis_url: env_or("REDIS_URL", "redis://localhost:6379"),
            jwt_secret: {
                let secret = std::env::var("JWT_SECRET")
                    .expect("FATAL: JWT_SECRET must be set. Refusing to start without it.");
                if secret.len() < 32 {
                    panic!("FATAL: JWT_SECRET is too short ({} chars). Minimum 32 characters required.", secret.len());
                }
                secret
            },
            server_port: env_or("SERVER_PORT", "8080")
                .parse()
                .expect("SERVER_PORT must be a valid u16"),
            minio_endpoint: env_or("MINIO_ENDPOINT", "http://localhost:9000"),
            minio_access_key: env_or("MINIO_ACCESS_KEY", "jolkr"),
            minio_secret_key: env_or("MINIO_SECRET_KEY", "jolkr_dev_secret"),
            minio_bucket: env_or("MINIO_BUCKET", "jolkr"),
            nats_url: env_or("NATS_URL", "nats://localhost:4222"),
            nats_user: std::env::var("NATS_USER").ok(),
            nats_password: std::env::var("NATS_PASSWORD").ok(),
            nats_hmac_secret: {
                let secret = std::env::var("NATS_HMAC_SECRET")
                    .expect("FATAL: NATS_HMAC_SECRET must be set. Refusing to start without it.");
                if secret.len() < 32 {
                    panic!("FATAL: NATS_HMAC_SECRET is too short ({} chars). Minimum 32 characters required.", secret.len());
                }
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
        }
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
