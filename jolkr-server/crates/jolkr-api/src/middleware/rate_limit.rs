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
use serde_json::json;

/// Per-IP token bucket rate limiter.
#[derive(Clone)]
pub struct RateLimiter {
    buckets: Arc<DashMap<IpAddr, Bucket>>,
    max_tokens: u32,
    refill_rate: f64, // tokens per second
}

struct Bucket {
    tokens: f64,
    last_refill: Instant,
}

impl RateLimiter {
    pub fn new(max_tokens: u32, per_second: f64) -> Self {
        Self {
            buckets: Arc::new(DashMap::new()),
            max_tokens,
            refill_rate: per_second,
        }
    }

    /// Spawn a background task that periodically removes stale entries from
    /// the bucket map (entries whose `last_refill` is older than 10 minutes).
    /// Runs every 5 minutes.
    pub fn spawn_cleanup(&self) {
        let buckets = Arc::clone(&self.buckets);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5 * 60));
            loop {
                interval.tick().await;
                let cutoff = Instant::now() - std::time::Duration::from_secs(10 * 60);
                buckets.retain(|_ip, bucket| bucket.last_refill > cutoff);
            }
        });
    }

    /// Try to consume one token. Returns true if allowed.
    fn try_consume(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut entry = self.buckets.entry(ip).or_insert_with(|| Bucket {
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
pub async fn rate_limit_middleware(
    Extension(limiter): Extension<RateLimiter>,
    req: Request<Body>,
    next: Next,
) -> Response {
    // Extract client IP from ConnectInfo (the actual TCP connection source).
    let connect_ip = req
        .extensions()
        .get::<ConnectInfo<std::net::SocketAddr>>()
        .map(|ci| ci.0.ip());

    // Only trust X-Forwarded-For when the direct connection comes from a trusted
    // proxy (localhost or Docker network). Parse the FIRST IP in the chain, which
    // is the original client IP set by the first proxy.
    let ip = if connect_ip.map_or(false, is_trusted_proxy) {
        req.headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next())
            .and_then(|s| s.trim().parse::<IpAddr>().ok())
            .or(connect_ip)
            .unwrap_or_else(|| "127.0.0.1".parse().unwrap())
    } else {
        connect_ip.unwrap_or_else(|| "127.0.0.1".parse().unwrap())
    };

    if !limiter.try_consume(ip) {
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
