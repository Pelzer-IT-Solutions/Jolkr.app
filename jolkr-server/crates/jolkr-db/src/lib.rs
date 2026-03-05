pub mod models;
pub mod repo;

use sqlx::postgres::{PgPool, PgPoolOptions};
use tracing::info;

/// Create a connection pool to the PostgreSQL database.
pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .idle_timeout(std::time::Duration::from_secs(600))
        .connect(database_url)
        .await?;

    info!("Database connection pool created successfully");
    Ok(pool)
}

/// Run pending sqlx migrations against the database.
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    info!("Running database migrations...");
    sqlx::migrate!("../../migrations").run(pool).await?;
    info!("Database migrations completed");
    Ok(())
}
