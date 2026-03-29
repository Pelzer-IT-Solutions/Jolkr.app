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

use jolkr_common::Permissions;
use jolkr_core::AuthService;
use jolkr_db::repo::{ChannelRepo, DmRepo, MemberRepo, RoleRepo, ServerRepo};

use super::events::{ClientEvent, GatewayEvent};
use crate::routes::AppState;

/// Maximum WebSocket connections allowed per IP address.
const MAX_WS_PER_IP: u32 = 10;

/// Global per-IP WebSocket connection counter.
static WS_CONNECTIONS: LazyLock<DashMap<IpAddr, AtomicU32>> = LazyLock::new(DashMap::new);

/// Extract the real client IP from the request, considering trusted proxies.
fn resolve_client_ip(connect_addr: std::net::SocketAddr, headers: &HeaderMap) -> IpAddr {
    let connect_ip = connect_addr.ip();
    // Trust X-Forwarded-For only from loopback or Docker network (172.16.0.0/12)
    let is_trusted = match connect_ip {
        IpAddr::V4(v4) => v4.is_loopback() || (v4.octets()[0] == 172 && (v4.octets()[1] & 0xF0) == 16),
        IpAddr::V6(v6) => v6.is_loopback(),
    };
    if is_trusted {
        headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next())
            .and_then(|s| s.trim().parse::<IpAddr>().ok())
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
pub async fn ws_upgrade(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let ip = resolve_client_ip(addr, &headers);

    // Check per-IP connection limit
    let count = WS_CONNECTIONS
        .entry(ip)
        .or_insert_with(|| AtomicU32::new(0));
    if count.load(Ordering::Relaxed) >= MAX_WS_PER_IP {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    count.fetch_add(1, Ordering::Relaxed);
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
                    let _ = tx.try_send(GatewayEvent::Error {
                        message: "Message too large".into(),
                    });
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
            let _ = tx.try_send(GatewayEvent::Error {
                message: "Rate limit exceeded".into(),
            });
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
                let _ = tx.try_send(err);
                continue;
            }
        };

        match client_event {
            ClientEvent::Identify { token } => {
                // Reject re-identify on already authenticated connection
                if session_id.is_some() {
                    let _ = tx.try_send(GatewayEvent::Error {
                        message: "Already identified".to_string(),
                    });
                    continue;
                }
                // Validate the JWT
                match AuthService::validate_token(&state.jwt_secret, &token) {
                    Ok(claims) => {
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
                        let _ = tx.try_send(ready);
                        info!(user_id = %claims.sub, session_id = %sid, "WebSocket identified");
                    }
                    Err(e) => {
                        warn!("WebSocket authentication failed: {e}");
                        let err = GatewayEvent::Error {
                            message: "Authentication failed".to_string(),
                        };
                        let _ = tx.try_send(err);
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
                let _ = tx.try_send(GatewayEvent::HeartbeatAck { seq });
            }

            ClientEvent::Subscribe { channel_id } => {
                if let Some(sid) = session_id {
                    if let Some(uid) = user_id {
                        if can_access_channel(&state, uid, channel_id).await {
                            state.gateway.subscribe(&sid, channel_id);
                        } else {
                            let _ = tx.try_send(GatewayEvent::Error {
                                message: "Cannot subscribe: no access to channel".to_string(),
                            });
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
                        let _ = tx.try_send(err);
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
