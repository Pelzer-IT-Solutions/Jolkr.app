//! WebSocket signaling handler for voice channels.

use core::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::LazyLock;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::Deserialize;
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::sfu::types::{SfuCommand, SignalOut};

/// Shared state for voice WebSocket handlers.
#[derive(Clone)]
pub(crate) struct VoiceState {
    pub sfu_tx: std::sync::mpsc::Sender<SfuCommand>,
    pub jwt_secret: String,
    /// Redis connection for token blacklist lookups — kept as a `ConnectionManager`
    /// so it auto-reconnects on transient failures without locking the WS loop.
    pub redis: ConnectionManager,
}

/// Per-IP voice WS cap. Mirrors the chat WS limit so a single attacker IP
/// cannot pin the server with idle voice sockets.
const MAX_WS_PER_IP: u32 = 10;

/// Heartbeat timeout for the voice WS. If no message arrives in this window
/// the connection is closed — matches the chat WS behaviour.
const VOICE_HEARTBEAT_TIMEOUT_SECS: u64 = 90;

/// Per-connection message rate limit (token bucket).
const VOICE_RATE_PER_SEC: f64 = 30.0;
const VOICE_RATE_BURST: f64 = 30.0;

/// Global per-IP voice-WS connection counter.
static VOICE_WS_CONNECTIONS: LazyLock<DashMap<IpAddr, AtomicU32>> = LazyLock::new(DashMap::new);

/// Events sent from the client to the server over the voice WebSocket.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", content = "d")]
pub(crate) enum VoiceClientEvent {
    /// Authenticate with a JWT access token.
    Identify { token: String },
    /// Join a voice channel.
    Join {
        channel_id: Uuid,
        #[serde(default)]
        with_video: bool,
    },
    /// SDP answer to a server-initiated offer.
    Answer { sdp: String },
    /// ICE candidate from the client.
    IceCandidate { candidate: String },
    /// Leave the current voice channel.
    Leave,
    /// Toggle mute.
    Mute { muted: bool },
    /// Toggle deafen.
    Deafen { deafened: bool },
}

/// HTTP handler that upgrades to a voice WebSocket. Enforces the per-IP
/// connection cap before accepting the upgrade.
pub(crate) async fn ws_voice_upgrade(
    State(state): State<VoiceState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let ip = addr.ip();

    let count = VOICE_WS_CONNECTIONS
        .entry(ip)
        .or_insert_with(|| AtomicU32::new(0));
    let prev = count.fetch_add(1, Ordering::Relaxed);
    if prev >= MAX_WS_PER_IP {
        count.fetch_sub(1, Ordering::Relaxed);
        drop(count);
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    drop(count);

    ws.on_upgrade(move |socket| async move {
        handle_voice_ws(socket, state).await;
        if let Some(counter) = VOICE_WS_CONNECTIONS.get(&ip) {
            let prev = counter.fetch_sub(1, Ordering::Relaxed);
            if prev <= 1 {
                drop(counter);
                VOICE_WS_CONNECTIONS.remove(&ip);
            }
        }
    })
    .into_response()
}

/// Handle the full lifecycle of a voice WebSocket connection.
async fn handle_voice_ws(socket: WebSocket, state: VoiceState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    let mut user_id: Option<Uuid> = None;
    let mut joined = false;

    // Per-connection token bucket — same shape as the chat WS handler.
    let mut rate_tokens: f64 = VOICE_RATE_BURST;
    let mut last_refill = tokio::time::Instant::now();

    // Channel for receiving events from the SFU thread.
    let (signal_tx, mut signal_rx) = mpsc::unbounded_channel::<SignalOut>();

    let send_task = tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(core::time::Duration::from_secs(20));
        ping_interval.tick().await; // skip first immediate tick

        loop {
            tokio::select! {
                event = signal_rx.recv() => {
                    match event {
                        Some(event) => {
                            let json = match serde_json::to_string(&event) {
                                Ok(j) => j,
                                Err(e) => {
                                    warn!("Failed to serialize voice event: {}", e);
                                    continue;
                                }
                            };
                            if ws_sender.send(Message::Text(json)).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                _ = ping_interval.tick() => {
                    if ws_sender.send(Message::Ping(vec![])).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    let heartbeat_timeout = core::time::Duration::from_secs(VOICE_HEARTBEAT_TIMEOUT_SECS);
    while let Ok(Some(Ok(msg))) = tokio::time::timeout(heartbeat_timeout, ws_receiver.next()).await {
        let text = match msg {
            Message::Text(t) => t.clone(),
            Message::Close(_) => break,
            _ => continue,
        };

        // Per-connection rate limit (30/sec burst 30).
        let now_rl = tokio::time::Instant::now();
        rate_tokens = (rate_tokens
            + now_rl.duration_since(last_refill).as_secs_f64() * VOICE_RATE_PER_SEC)
            .min(VOICE_RATE_BURST);
        last_refill = now_rl;
        if rate_tokens < 1.0 {
            warn!("Voice WS rate limit exceeded");
            drop(signal_tx.send(SignalOut::Error {
                message: "Rate limit exceeded".into(),
            }));
            continue;
        }
        rate_tokens -= 1.0;

        let event: VoiceClientEvent = match serde_json::from_str(&text) {
            Ok(e) => e,
            Err(e) => {
                drop(signal_tx.send(SignalOut::Error {
                    message: format!("Invalid message: {e}"),
                }));
                continue;
            }
        };

        match event {
            VoiceClientEvent::Identify { token } => {
                match validate_jwt(&state.jwt_secret, &token) {
                    Ok(claims) => {
                        // Honour the API server's token blacklist (logout writes
                        // blacklist:{jti}). Fail CLOSED on Redis errors — mirrors
                        // F11. Without the blacklist we can't tell whether the
                        // token is still valid; refuse rather than silently honour.
                        let blacklist_key = format!("blacklist:{}", claims.jti);
                        let mut conn = state.redis.clone();
                        let is_revoked: bool = match conn.exists(&blacklist_key).await {
                            Ok(b) => b,
                            Err(e) => {
                                error!(error = %e, "Voice WS: Redis blacklist check failed");
                                drop(signal_tx.send(SignalOut::Error {
                                    message: "Auth backend unavailable".into(),
                                }));
                                continue;
                            }
                        };
                        if is_revoked {
                            drop(signal_tx.send(SignalOut::Error {
                                message: "Token has been revoked".into(),
                            }));
                            continue;
                        }

                        user_id = Some(claims.sub);
                        info!(user_id = %claims.sub, "Voice WS identified");
                    }
                    Err(e) => {
                        drop(signal_tx.send(SignalOut::Error {
                            message: format!("Authentication failed: {e}"),
                        }));
                    }
                }
            }

            VoiceClientEvent::Join { channel_id, with_video } => {
                let uid = if let Some(id) = user_id { id } else {
                    drop(signal_tx.send(SignalOut::Error {
                        message: "Not authenticated".into(),
                    }));
                    continue;
                };

                joined = true;

                drop(state.sfu_tx.send(SfuCommand::AddPeer {
                    user_id: uid,
                    channel_id,
                    signal_tx: signal_tx.clone(),
                    with_video,
                }));
            }

            VoiceClientEvent::Answer { sdp } => {
                if let Some(uid) = user_id {
                    drop(state.sfu_tx.send(SfuCommand::Answer {
                        user_id: uid,
                        sdp,
                    }));
                }
            }

            VoiceClientEvent::IceCandidate { candidate } => {
                if let Some(uid) = user_id {
                    drop(state.sfu_tx.send(SfuCommand::IceCandidate {
                        user_id: uid,
                        candidate,
                    }));
                }
            }

            VoiceClientEvent::Leave => {
                if let Some(uid) = user_id {
                    drop(state.sfu_tx.send(SfuCommand::Leave { user_id: uid }));
                    joined = false;
                }
            }

            VoiceClientEvent::Mute { muted } => {
                if let Some(uid) = user_id {
                    drop(state.sfu_tx.send(SfuCommand::Mute {
                        user_id: uid,
                        muted,
                    }));
                }
            }

            VoiceClientEvent::Deafen { deafened } => {
                if let Some(uid) = user_id {
                    drop(state.sfu_tx.send(SfuCommand::Deafen {
                        user_id: uid,
                        deafened,
                    }));
                }
            }
        }
    }

    // Cleanup: leave room if still joined
    if let (Some(uid), true) = (user_id, joined) {
        drop(state.sfu_tx.send(SfuCommand::Leave { user_id: uid }));
        info!(user_id = %uid, "Voice WS disconnected, sent Leave");
    }

    send_task.abort();
}

/// JWT claims — must match the API server's token structure.
#[derive(Debug, Deserialize)]
struct Claims {
    sub: Uuid,
    /// Used for token-blacklist lookups (matches `AuthService::Claims.jti`).
    jti: String,
    #[expect(dead_code)]
    exp: i64,
}

fn validate_jwt(secret: &str, token: &str) -> Result<Claims, String> {
    let key = jsonwebtoken::DecodingKey::from_secret(secret.as_bytes());
    // Pin the algorithm — Validation::default() can be permissive about which
    // algorithms it accepts; mirror what the API server's AuthService does so
    // a token forged for another algorithm can't slip through here.
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.validate_exp = true;
    jsonwebtoken::decode::<Claims>(token, &key, &validation)
        .map(|data| data.claims)
        .map_err(|e| e.to_string())
}
