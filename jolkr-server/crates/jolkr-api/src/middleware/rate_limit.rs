use std::net::IpAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::{
    body::Body,
    extract::{ConnectInfo, Extension},
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use redis::AsyncCommands;
use serde_json::json;
use tracing::warn;

use crate::redis_store::RedisStore;

/// Per-IP rate limiter with Redis backend and local DashMap fallback.
#[derive(Clone)]
pub(crate) struct RateLimiter {
    name: String,
    max_tokens: u32,
    window_secs: u64,
    redis: Option<RedisStore>,
    local: Arc<DashMap<IpAddr, LocalBucket>>,
    refill_rate: f64,
}

struct LocalBucket {
    tokens: f64,
    last_refill: Instant,
}

impl RateLimiter {
    /// Create a new rate limiter. If `redis` is Some, uses distributed Redis counters
    /// with local DashMap fallback. If None, uses only local DashMap.
    pub(crate) fn new(name: &str, max_tokens: u32, per_second: f64, redis: Option<RedisStore>) -> Self {
        Self {
            name: name.to_string(),
            max_tokens,
            window_secs: 1,
            redis,
            local: Arc::new(DashMap::new()),
            refill_rate: per_second,
        }
    }

    /// Spawn a background task that periodically removes stale local entries.
    pub(crate) fn spawn_cleanup(&self) {
        let local = Arc::clone(&self.local);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5 * 60));
            loop {
                interval.tick().await;
                let cutoff = Instant::now() - std::time::Duration::from_secs(10 * 60);
                local.retain(|_ip, bucket| bucket.last_refill > cutoff);
            }
        });
    }

    /// Try to consume one token. Uses Redis first, falls back to local DashMap.
    async fn try_consume(&self, ip: IpAddr) -> bool {
        if let Some(ref redis) = self.redis {
            match self.try_consume_redis(redis, ip).await {
                Ok(allowed) => return allowed,
                Err(e) => {
                    warn!(error = %e, limiter = %self.name, "Redis rate limit failed, using local fallback");
                }
            }
        }
        self.try_consume_local(ip)
    }

    /// Redis sliding window: INCR key, set EXPIRE on first hit, check against max.
    async fn try_consume_redis(&self, redis: &RedisStore, ip: IpAddr) -> Result<bool, redis::RedisError> {
        let key = format!("rl:{}:{}", self.name, ip);
        let mut conn = redis.connection();

        // INCR atomically increments and returns the new count.
        // If the key didn't exist, Redis creates it with value 1.
        let count: u64 = conn.incr(&key, 1u64).await?;

        // Set expiry only on the first request in this window (count == 1)
        if count == 1 {
            conn.expire::<_, ()>(&key, self.window_secs as i64).await?;
        }

        Ok(count <= self.max_tokens as u64)
    }

    /// Local token bucket fallback (same algorithm as before).
    fn try_consume_local(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut entry = self.local.entry(ip).or_insert_with(|| LocalBucket {
            tokens: self.max_tokens as f64,
            last_refill: now,
        });

        let bucket = entry.value_mut();
        let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.refill_rate).min(self.max_tokens as f64);
        bucket.last_refill = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Check if an IP is a trusted proxy (localhost or Docker network 172.16.0.0/12).
fn is_trusted_proxy(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || (v4.octets()[0] == 172 && (v4.octets()[1] & 0xF0) == 16),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

/// Axum middleware function for rate limiting.
pub(crate) async fn rate_limit_middleware(
    Extension(limiter): Extension<RateLimiter>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let connect_ip = req
        .extensions()
        .get::<ConnectInfo<std::net::SocketAddr>>()
        .map(|ci| ci.0.ip());

    let ip = if connect_ip.map_or(false, is_trusted_proxy) {
        // Take the rightmost non-trusted IP — that's the one added by our outermost proxy.
        // The leftmost IP is attacker-controlled and must not be trusted.
        req.headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| {
                s.split(',')
                    .rev()
                    .map(|p| p.trim())
                    .filter_map(|p| p.parse::<IpAddr>().ok())
                    .find(|ip| !is_trusted_proxy(*ip))
            })
            .or(connect_ip)
            .unwrap_or_else(|| "127.0.0.1".parse().unwrap())
    } else {
        connect_ip.unwrap_or_else(|| "127.0.0.1".parse().unwrap())
    };

    if !limiter.try_consume(ip).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "error": {
                    "code": 429,
                    "message": "Too many requests. Please slow down."
                }
            })),
        )
            .into_response();
    }

    next.run(req).await
}
