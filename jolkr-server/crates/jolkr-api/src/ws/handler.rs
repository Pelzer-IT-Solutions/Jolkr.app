use std::net::IpAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::LazyLock;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, State, WebSocketUpgrade,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use uuid::Uuid;

use base64::Engine;
use rand::RngCore;
use redis::AsyncCommands;
use jolkr_common::Permissions;
use jolkr_core::AuthService;
use jolkr_core::crypto::keys::verify_signed_prekey;
use jolkr_db::repo::{ChannelRepo, DmRepo, KeyRepo, MemberRepo, RoleRepo, ServerRepo};

use super::events::{ClientEvent, GatewayEvent};
use crate::routes::AppState;

/// Maximum WebSocket connections allowed per IP address.
const MAX_WS_PER_IP: u32 = 10;

/// SEC-013 nonce window. The base64-encoded random nonce is sent in
/// `Hello` immediately after upgrade and must round-trip in `Identify`
/// before this Duration elapses; otherwise the handshake is rejected.
const HELLO_NONCE_TTL: tokio::time::Duration = tokio::time::Duration::from_secs(30);

/// Global per-IP WebSocket connection counter.
static WS_CONNECTIONS: LazyLock<DashMap<IpAddr, AtomicU32>> = LazyLock::new(DashMap::new);

/// Extract the real client IP from the request, considering trusted proxies.
fn is_trusted_proxy_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || (v4.octets()[0] == 172 && (v4.octets()[1] & 0xF0) == 16),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

fn resolve_client_ip(connect_addr: std::net::SocketAddr, headers: &HeaderMap) -> IpAddr {
    let connect_ip = connect_addr.ip();
    if is_trusted_proxy_ip(connect_ip) {
        // Take the rightmost non-trusted IP (attacker can't control it)
        headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| {
                s.split(',')
                    .rev()
                    .map(|p| p.trim())
                    .filter_map(|p| p.parse::<IpAddr>().ok())
                    .find(|ip| !is_trusted_proxy_ip(*ip))
            })
            .unwrap_or(connect_ip)
    } else {
        connect_ip
    }
}

/// Check if a user has access to a channel (regular or DM).
/// For regular channels: checks VIEW_CHANNELS permission (with channel overwrites).
/// Server owner always has access.
async fn can_access_channel(state: &AppState, user_id: Uuid, channel_id: Uuid) -> bool {
    // Try as a regular channel first
    if let Ok(channel) = ChannelRepo::get_by_id(&state.pool, channel_id).await {
        if let Ok(member) = MemberRepo::get_member(&state.pool, channel.server_id, user_id).await {
            // Owner always has access
            if let Ok(server) = ServerRepo::get_by_id(&state.pool, channel.server_id).await {
                if server.owner_id == user_id {
                    return true;
                }
            }
            // Check VIEW_CHANNELS with channel overwrites
            if let Ok(perms) = RoleRepo::compute_channel_permissions(
                &state.pool, channel.server_id, channel_id, member.id,
            ).await {
                return Permissions::from(perms).has(Permissions::VIEW_CHANNELS);
            }
        }
        return false;
    }
    // Try as a DM channel
    if let Ok(is_member) = DmRepo::is_member(&state.pool, channel_id, user_id).await {
        return is_member;
    }
    false
}

/// HTTP handler that upgrades the connection to a WebSocket.
/// Enforces per-IP connection limit before upgrading.
pub(crate) async fn ws_upgrade(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let ip = resolve_client_ip(addr, &headers);

    // Check per-IP connection limit (atomic increment-then-check to avoid race condition)
    let count = WS_CONNECTIONS
        .entry(ip)
        .or_insert_with(|| AtomicU32::new(0));
    let prev = count.fetch_add(1, Ordering::Relaxed);
    if prev >= MAX_WS_PER_IP {
        // Over limit — revert the increment and reject
        count.fetch_sub(1, Ordering::Relaxed);
        drop(count);
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    drop(count);

    ws.on_upgrade(move |socket| async move {
        handle_socket(socket, state).await;
        // Decrement connection count on disconnect
        if let Some(counter) = WS_CONNECTIONS.get(&ip) {
            let prev = counter.fetch_sub(1, Ordering::Relaxed);
            if prev <= 1 {
                drop(counter);
                WS_CONNECTIONS.remove(&ip);
            }
        }
    })
    .into_response()
}

/// Handles the full lifecycle of a single WebSocket connection.
async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Create a bounded channel for backpressure (256 queued events max)
    let (tx, mut rx) = mpsc::channel::<GatewayEvent>(256);

    // We don't know the user yet; they must send an Identify event first.
    let mut session_id: Option<Uuid> = None;
    let mut user_id: Option<Uuid> = None;
    let mut last_heartbeat = tokio::time::Instant::now();

    // Per-connection message rate limiter (token bucket: 30 msgs/sec, burst 30)
    let mut rate_tokens: f64 = 30.0;
    let mut last_refill = tokio::time::Instant::now();

    // SEC-013 challenge nonce (per-socket, single-use). 32 random bytes
    // base64-encoded; client signs the raw bytes and echoes both back in
    // `Identify`. Sig verification is unconditional — Identify without a
    // valid ed25519 signature over the raw nonce is rejected.
    let hello_deadline = tokio::time::Instant::now() + HELLO_NONCE_TTL;
    let (mut hello_nonce_b64, mut hello_nonce_bytes): (Option<String>, Option<[u8; 32]>) = {
        let mut buf = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut buf);
        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf);
        let expires_at = (chrono::Utc::now()
            + chrono::Duration::seconds(HELLO_NONCE_TTL.as_secs() as i64))
            .to_rfc3339();
        drop(tx.try_send(GatewayEvent::Hello {
            nonce: b64.clone(),
            expires_at,
        }));
        (Some(b64), Some(buf))
    };

    // Spawn a task that forwards gateway events to the WebSocket sender
    let send_task = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let json = match serde_json::to_string(&event) {
                Ok(j) => j,
                Err(e) => {
                    error!("Failed to serialize gateway event: {e}");
                    continue;
                }
            };
            if ws_sender.send(Message::Text(json.into())).await.is_err() {
                break; // connection closed
            }
        }
    });

    // Main receive loop: read messages from the client
    // Use a heartbeat timeout to detect zombie connections
    let heartbeat_timeout = tokio::time::Duration::from_secs(90);
    while let Ok(Some(Ok(msg))) = tokio::time::timeout(heartbeat_timeout, ws_receiver.next()).await {
        let text = match msg {
            Message::Text(t) => {
                let s = t.to_string();
                if s.len() > 65_536 {
                    warn!("WebSocket message too large: {} bytes", s.len());
                    drop(tx.try_send(GatewayEvent::Error {
                        message: "Message too large".into(),
                    }));
                    continue;
                }
                s
            }
            Message::Close(_) => break,
            _ => continue, // ignore binary/ping/pong
        };

        // Per-connection rate limiting (30 msgs/sec)
        let now_rl = tokio::time::Instant::now();
        rate_tokens = (rate_tokens + now_rl.duration_since(last_refill).as_secs_f64() * 30.0).min(30.0);
        last_refill = now_rl;
        if rate_tokens < 1.0 {
            warn!("WebSocket rate limit exceeded");
            drop(tx.try_send(GatewayEvent::Error {
                message: "Rate limit exceeded".into(),
            }));
            continue;
        }
        rate_tokens -= 1.0;

        let client_event: ClientEvent = match serde_json::from_str(&text) {
            Ok(e) => e,
            Err(e) => {
                warn!("Invalid client event: {e}");
                let err = GatewayEvent::Error {
                    message: "Invalid event format".to_string(),
                };
                drop(tx.try_send(err));
                continue;
            }
        };

        match client_event {
            ClientEvent::Identify { token, device_id, nonce, signature } => {
                // Reject re-identify on already authenticated connection
                if session_id.is_some() {
                    drop(tx.try_send(GatewayEvent::Error {
                        message: "Already identified".to_string(),
                    }));
                    continue;
                }

                // SEC-013 challenge-response: signature is required.
                // Generic "Authentication failed" for every failure mode so
                // an attacker can't distinguish unknown-device from
                // bad-signature from expired-window.
                let sig_check_passed = match (&device_id, &nonce, &signature) {
                    (Some(dev_id), Some(client_nonce), Some(client_sig)) => {
                        // Nonce must match this socket's challenge and arrive
                        // within the TTL window. After verify, the nonce slot
                        // is consumed (set to None) so a replay on the same
                        // connection fails the second-Identify guard above.
                        let server_nonce = hello_nonce_b64.as_deref();
                        let nonce_ok = server_nonce == Some(client_nonce.as_str())
                            && tokio::time::Instant::now() <= hello_deadline;
                        let raw_nonce = hello_nonce_bytes;
                        let signature_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
                            .decode(client_sig.as_bytes())
                            .ok();

                        if !nonce_ok || signature_bytes.is_none() {
                            false
                        } else if let (Some(raw), Some(sig)) = (raw_nonce, signature_bytes) {
                            // Look up the identity_key for (sub_from_jwt, device_id).
                            // The JWT claims subject is needed first, so do a
                            // best-effort decode here; the full validate_token
                            // happens below regardless.
                            let pre_claims = AuthService::validate_token(&state.jwt_secret, &token);
                            match pre_claims {
                                Ok(c) => {
                                    match KeyRepo::get_identity_key(&state.pool, c.sub, *dev_id).await {
                                        Ok(Some(pubkey)) => verify_signed_prekey(&pubkey, &raw, &sig),
                                        _ => false,
                                    }
                                }
                                Err(_) => false,
                            }
                        } else {
                            false
                        }
                    }
                    _ => false,
                };

                if !sig_check_passed {
                    warn!("WebSocket sig check failed");
                    drop(tx.try_send(GatewayEvent::Error {
                        message: "Authentication failed".to_string(),
                    }));
                    continue;
                }

                // Single-use nonce: consume it regardless of whether sig
                // was checked. Subsequent Identify on this socket will hit
                // the `session_id.is_some()` re-identify guard.
                hello_nonce_b64 = None;
                hello_nonce_bytes = None;

                // Validate the JWT and check blacklist (mirrors HTTP auth middleware)
                match AuthService::validate_token(&state.jwt_secret, &token) {
                    Ok(claims) => {
                        // Check if this token has been revoked (e.g. via logout)
                        let blacklist_key = format!("blacklist:{}", claims.jti);
                        let mut conn = state.redis.connection();
                        let is_revoked: bool = conn.exists(&blacklist_key).await.unwrap_or(false);
                        if is_revoked {
                            let err = GatewayEvent::Error {
                                message: "Token has been revoked".to_string(),
                            };
                            drop(tx.try_send(err));
                            continue;
                        }

                        let sid = Uuid::new_v4();
                        session_id = Some(sid);
                        user_id = Some(claims.sub);

                        // Register the client in the gateway
                        state.gateway.add_client(sid, claims.sub, tx.clone());

                        // Auto-subscribe to all servers the user is a member of
                        if let Ok(server_ids) = MemberRepo::list_server_ids_for_user(&state.pool, claims.sub).await {
                            state.gateway.subscribe_servers(&sid, server_ids);
                        }

                        // Set presence to online in Redis + register session
                        state.redis.set_presence(claims.sub, "online").await;
                        state.redis.add_session(claims.sub, sid).await;

                        // Publish presence update via NATS → all instances
                        let presence_event = GatewayEvent::PresenceUpdate {
                            user_id: claims.sub,
                            status: "online".to_string(),
                        };
                        state.nats.publish_presence(&presence_event).await;

                        // Send Ready event
                        let ready = GatewayEvent::Ready {
                            user_id: claims.sub,
                            session_id: sid,
                        };
                        drop(tx.try_send(ready));
                        info!(user_id = %claims.sub, session_id = %sid, "WebSocket identified");
                    }
                    Err(e) => {
                        warn!("WebSocket authentication failed: {e}");
                        let err = GatewayEvent::Error {
                            message: "Authentication failed".to_string(),
                        };
                        drop(tx.try_send(err));
                    }
                }
            }

            ClientEvent::Heartbeat { seq } => {
                last_heartbeat = tokio::time::Instant::now();
                // Refresh presence + session TTLs on heartbeat
                if let Some(uid) = user_id {
                    state.redis.refresh_presence(uid).await;
                    state.redis.refresh_sessions(uid).await;
                }
                drop(tx.try_send(GatewayEvent::HeartbeatAck { seq }));
            }

            ClientEvent::Subscribe { channel_id } => {
                if let Some(sid) = session_id {
                    if let Some(uid) = user_id {
                        if can_access_channel(&state, uid, channel_id).await {
                            state.gateway.subscribe(&sid, channel_id);
                        } else {
                            drop(tx.try_send(GatewayEvent::Error {
                                message: "Cannot subscribe: no access to channel".to_string(),
                            }));
                        }
                    }
                }
            }

            ClientEvent::Unsubscribe { channel_id } => {
                if let Some(sid) = session_id {
                    state.gateway.unsubscribe(&sid, channel_id);
                }
            }

            ClientEvent::TypingStart { channel_id } => {
                if let Some(uid) = user_id {
                    if can_access_channel(&state, uid, channel_id).await {
                        let event = GatewayEvent::TypingStart {
                            channel_id,
                            user_id: uid,
                            timestamp: chrono::Utc::now().timestamp(),
                        };
                        state.nats.publish_to_channel(channel_id, &event).await;
                    }
                }
            }

            ClientEvent::PresenceUpdate { status } => {
                if let Some(uid) = user_id {
                    // Validate status
                    let valid = crate::redis_store::VALID_STATUSES;
                    if valid.contains(&status.as_str()) {
                        state.redis.set_presence(uid, &status).await;
                        let event = GatewayEvent::PresenceUpdate {
                            user_id: uid,
                            status,
                        };
                        state.nats.publish_presence(&event).await;
                    } else {
                        let err = GatewayEvent::Error {
                            message: format!("Invalid status. Must be one of: {}", valid.join(", ")),
                        };
                        drop(tx.try_send(err));
                    }
                }
            }

            ClientEvent::RequestKeyRedistribute { channel_id } => {
                if let Some(uid) = user_id {
                    if !DmRepo::is_member(&state.pool, channel_id, uid).await.unwrap_or(false) {
                        continue;
                    }
                    let members = DmRepo::get_dm_members(&state.pool, channel_id).await.unwrap_or_default();
                    let event = GatewayEvent::KeyRedistributeRequest {
                        channel_id,
                        requester_id: uid,
                    };
                    for m in members {
                        if m.user_id == uid { continue; }
                        state.nats.publish_to_user(m.user_id, &event).await;
                    }
                }
            }
        }
    }
    // Heartbeat timeout — log if applicable
    if let Some(uid) = user_id {
        if last_heartbeat.elapsed() >= heartbeat_timeout {
            info!(user_id = %uid, "Client disconnected due to heartbeat timeout");
        }
    }

    // Client disconnected — cleanup
    if let Some(uid) = user_id {
        // Remove this session from the cross-instance Redis session set
        if let Some(sid) = session_id {
            state.redis.remove_session(uid, sid).await;
        }
        // Only broadcast offline if no sessions remain (across ALL instances)
        let remaining = state.redis.count_sessions(uid).await;
        if remaining == 0 {
            state.redis.remove_presence(uid).await;
            let event = GatewayEvent::PresenceUpdate {
                user_id: uid,
                status: "offline".to_string(),
            };
            state.nats.publish_presence(&event).await;
        }
    }
    if let Some(sid) = session_id {
        state.gateway.remove_client(&sid);
    }
    send_task.abort();
}
