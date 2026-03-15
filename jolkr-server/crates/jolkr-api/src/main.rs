use std::net::SocketAddr;

use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;

mod config;
pub mod embed_service;
pub mod email_service;
mod errors;
mod middleware;
pub mod nats_bus;
pub mod push_service;
pub mod redis_store;
mod routes;
pub mod image_processing;
pub mod storage;
mod ws;

use config::Config;

#[tokio::main]
async fn main() {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    info!("Jolkr API server starting...");

    // Record start time for health check uptime
    routes::health::init_start_time();

    // Load configuration from environment variables
    let config = Config::from_env();

    // Create database connection pool
    let pool = jolkr_db::create_pool(&config.database_url)
        .await
        .expect("Failed to create database pool");

    // Run pending migrations
    jolkr_db::run_migrations(&pool)
        .await
        .expect("Failed to run database migrations");

    // Connect to Redis
    let redis = redis_store::RedisStore::new(&config.redis_url)
        .await
        .expect("Failed to connect to Redis");

    // Connect to NATS (with auth + HMAC signing)
    let nats = nats_bus::NatsBus::connect(
        &config.nats_url,
        &config.nats_hmac_secret,
        config.nats_user.as_deref(),
        config.nats_password.as_deref(),
    )
    .await
    .expect("Failed to connect to NATS");

    // Connect to S3 / MinIO
    let storage = storage::Storage::new(
        &config.minio_endpoint,
        &config.minio_access_key,
        &config.minio_secret_key,
        &config.minio_bucket,
    )
    .await
    .expect("Failed to connect to S3/MinIO");

    // Build application state
    let gateway = ws::gateway::GatewayState::new();

    // Spawn NATS → local gateway subscriber (distributes events from other instances)
    nats.spawn_subscriber(gateway.clone());

    // Push notification service
    let push = push_service::PushService::new(
        pool.clone(),
        gateway.clone(),
        config.vapid_private_key.clone(),
        config.vapid_public_key.clone(),
        config.vapid_subject.clone(),
    );

    // Email service (SMTP for password resets)
    let email = email_service::EmailService::new(
        config.smtp_host.as_deref(),
        config.smtp_port,
        &config.smtp_from,
    );

    // Link embed service (fetches URL previews async)
    let embed = embed_service::LinkEmbedService::new();

    let app_state = routes::AppState {
        pool,
        jwt_secret: config.jwt_secret.clone(),
        gateway,
        redis,
        nats,
        storage,
        push,
        email,
        embed,
        app_url: config.app_url.clone(),
    };

    // Build the Axum router
    let app = routes::create_router(app_state);

    // Start listening
    let addr = SocketAddr::from(([0, 0, 0, 0], config.server_port));
    info!("Listening on {}", addr);

    let listener = TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener");

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .expect("Server error");
}
