use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use tracing::{error, info};
use uuid::Uuid;

/// Redis key prefix for user presence.
const PRESENCE_PREFIX: &str = "presence:";

/// Redis key prefix for active WebSocket session tracking (cross-instance).
const SESSIONS_PREFIX: &str = "sessions:";

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

    /// Get a cloned connection manager for direct Redis operations.
    pub fn connection(&self) -> ConnectionManager {
        self.conn.clone()
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

    // ── Session tracking (multi-instance safe) ──────────────────────────

    /// Register a WebSocket session in a shared Redis SET (for multi-instance presence).
    pub async fn add_session(&self, user_id: Uuid, session_id: Uuid) {
        let key = format!("{SESSIONS_PREFIX}{user_id}");
        let mut conn = self.conn.clone();
        if let Err(e) = conn.sadd::<_, _, ()>(&key, session_id.to_string()).await {
            error!(user_id = %user_id, error = %e, "Failed to add session to Redis");
        }
        if let Err(e) = conn.expire::<_, ()>(&key, PRESENCE_TTL_SECS as i64).await {
            error!(user_id = %user_id, error = %e, "Failed to set session TTL");
        }
    }

    /// Remove a WebSocket session from the shared Redis SET.
    pub async fn remove_session(&self, user_id: Uuid, session_id: Uuid) {
        let key = format!("{SESSIONS_PREFIX}{user_id}");
        let mut conn = self.conn.clone();
        if let Err(e) = conn.srem::<_, _, ()>(&key, session_id.to_string()).await {
            error!(user_id = %user_id, error = %e, "Failed to remove session from Redis");
        }
    }

    /// Count active sessions for a user across all instances.
    pub async fn count_sessions(&self, user_id: Uuid) -> u64 {
        let key = format!("{SESSIONS_PREFIX}{user_id}");
        let mut conn = self.conn.clone();
        conn.scard::<_, u64>(&key).await.unwrap_or(0)
    }

    /// Refresh TTL on the sessions SET (called on heartbeat).
    pub async fn refresh_sessions(&self, user_id: Uuid) {
        let key = format!("{SESSIONS_PREFIX}{user_id}");
        let mut conn = self.conn.clone();
        if let Err(e) = conn.expire::<_, ()>(&key, PRESENCE_TTL_SECS as i64).await {
            error!(user_id = %user_id, error = %e, "Failed to refresh sessions TTL");
        }
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
