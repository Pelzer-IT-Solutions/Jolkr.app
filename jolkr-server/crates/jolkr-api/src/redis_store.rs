use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use tracing::{error, info};
use uuid::Uuid;

/// Redis key prefix for user presence.
const PRESENCE_PREFIX: &str = "presence:";

/// Default presence TTL (5 minutes). Heartbeats refresh it.
const PRESENCE_TTL_SECS: u64 = 300;

/// Valid presence statuses.
pub const VALID_STATUSES: &[&str] = &["online", "idle", "dnd", "invisible"];

/// A thin wrapper around a Redis connection manager for presence operations.
#[derive(Clone)]
pub struct RedisStore {
    conn: ConnectionManager,
}

impl RedisStore {
    /// Create a new RedisStore by connecting to the given URL.
    pub async fn new(redis_url: &str) -> Result<Self, redis::RedisError> {
        let client = redis::Client::open(redis_url)?;
        let conn = ConnectionManager::new(client).await?;
        info!("Redis connection established");
        Ok(Self { conn })
    }

    /// Set a user's presence status with a TTL.
    pub async fn set_presence(&self, user_id: Uuid, status: &str) {
        let key = format!("{PRESENCE_PREFIX}{user_id}");
        let mut conn = self.conn.clone();
        if let Err(e) = conn
            .set_ex::<_, _, ()>(&key, status, PRESENCE_TTL_SECS)
            .await
        {
            error!(user_id = %user_id, error = %e, "Failed to set presence in Redis");
        }
    }

    /// Refresh the TTL on a user's presence (called on heartbeat).
    pub async fn refresh_presence(&self, user_id: Uuid) {
        let key = format!("{PRESENCE_PREFIX}{user_id}");
        let mut conn = self.conn.clone();
        if let Err(e) = conn.expire::<_, ()>(&key, PRESENCE_TTL_SECS as i64).await {
            error!(user_id = %user_id, error = %e, "Failed to refresh presence TTL");
        }
    }

    /// Remove a user's presence (on disconnect).
    pub async fn remove_presence(&self, user_id: Uuid) {
        let key = format!("{PRESENCE_PREFIX}{user_id}");
        let mut conn = self.conn.clone();
        if let Err(e) = conn.del::<_, ()>(&key).await {
            error!(user_id = %user_id, error = %e, "Failed to remove presence from Redis");
        }
    }

    /// Get a single user's presence status.
    pub async fn get_presence(&self, user_id: Uuid) -> String {
        let key = format!("{PRESENCE_PREFIX}{user_id}");
        let mut conn = self.conn.clone();
        conn.get::<_, Option<String>>(&key)
            .await
            .unwrap_or(None)
            .unwrap_or_else(|| "offline".to_string())
    }

    /// Ping Redis to check connectivity. Returns Ok(()) on success.
    pub async fn ping(&self) -> Result<(), String> {
        let mut conn = self.conn.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Get presence for multiple users at once.
    pub async fn get_presences(&self, user_ids: &[Uuid]) -> Vec<(Uuid, String)> {
        if user_ids.is_empty() {
            return Vec::new();
        }

        let keys: Vec<String> = user_ids
            .iter()
            .map(|id| format!("{PRESENCE_PREFIX}{id}"))
            .collect();

        let mut conn = self.conn.clone();
        let results: Vec<Option<String>> = match redis::cmd("MGET")
            .arg(&keys)
            .query_async(&mut conn)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                error!(error = %e, "Failed to MGET presences from Redis");
                vec![None; user_ids.len()]
            }
        };

        user_ids
            .iter()
            .zip(results)
            .map(|(id, status)| (*id, status.unwrap_or_else(|| "offline".to_string())))
            .collect()
    }
}
