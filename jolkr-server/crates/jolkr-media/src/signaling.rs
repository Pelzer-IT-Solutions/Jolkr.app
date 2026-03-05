//! WebSocket signaling handler for voice channels.

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc;
use tracing::{info, warn};
use uuid::Uuid;

use crate::sfu::types::{SfuCommand, SignalOut};

/// Shared state for voice WebSocket handlers.
#[derive(Clone)]
pub struct VoiceState {
    pub sfu_tx: std::sync::mpsc::Sender<SfuCommand>,
    pub jwt_secret: String,
}

/// Events sent from the client to the server over the voice WebSocket.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", content = "d")]
pub enum VoiceClientEvent {
    /// Authenticate with a JWT access token.
    Identify { token: String },
    /// Join a voice channel.
    Join { channel_id: Uuid },
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

/// HTTP handler that upgrades to a voice WebSocket.
pub async fn ws_voice_upgrade(
    State(state): State<VoiceState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_voice_ws(socket, state))
}

/// Handle the full lifecycle of a voice WebSocket connection.
async fn handle_voice_ws(socket: WebSocket, state: VoiceState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    let mut user_id: Option<Uuid> = None;
    let mut joined = false;

    // Channel for receiving events from the SFU thread.
    // Created when the client joins a voice channel.
    let (signal_tx, mut signal_rx) = mpsc::unbounded_channel::<SignalOut>();

    // Spawn a task that forwards SFU events to the WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(event) = signal_rx.recv().await {
            let json = match serde_json::to_string(&event) {
                Ok(j) => j,
                Err(e) => {
                    warn!("Failed to serialize voice event: {}", e);
                    continue;
                }
            };
            if ws_sender.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    // Main receive loop
    while let Some(Ok(msg)) = ws_receiver.next().await {
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };

        let event: VoiceClientEvent = match serde_json::from_str(&text) {
            Ok(e) => e,
            Err(e) => {
                let _ = signal_tx.send(SignalOut::Error {
                    message: format!("Invalid message: {}", e),
                });
                continue;
            }
        };

        match event {
            VoiceClientEvent::Identify { token } => {
                match validate_jwt(&state.jwt_secret, &token) {
                    Ok(claims) => {
                        user_id = Some(claims.sub);
                        info!(user_id = %claims.sub, "Voice WS identified");
                    }
                    Err(e) => {
                        let _ = signal_tx.send(SignalOut::Error {
                            message: format!("Authentication failed: {}", e),
                        });
                    }
                }
            }

            VoiceClientEvent::Join { channel_id } => {
                let uid = match user_id {
                    Some(id) => id,
                    None => {
                        let _ = signal_tx.send(SignalOut::Error {
                            message: "Not authenticated".into(),
                        });
                        continue;
                    }
                };

                joined = true;

                let _ = state.sfu_tx.send(SfuCommand::AddPeer {
                    user_id: uid,
                    channel_id,
                    signal_tx: signal_tx.clone(),
                });
            }

            VoiceClientEvent::Answer { sdp } => {
                if let Some(uid) = user_id {
                    let _ = state.sfu_tx.send(SfuCommand::Answer {
                        user_id: uid,
                        sdp,
                    });
                }
            }

            VoiceClientEvent::IceCandidate { candidate } => {
                if let Some(uid) = user_id {
                    let _ = state.sfu_tx.send(SfuCommand::IceCandidate {
                        user_id: uid,
                        candidate,
                    });
                }
            }

            VoiceClientEvent::Leave => {
                if let Some(uid) = user_id {
                    let _ = state.sfu_tx.send(SfuCommand::Leave { user_id: uid });
                    joined = false;
                }
            }

            VoiceClientEvent::Mute { muted } => {
                if let Some(uid) = user_id {
                    let _ = state.sfu_tx.send(SfuCommand::Mute {
                        user_id: uid,
                        muted,
                    });
                }
            }

            VoiceClientEvent::Deafen { deafened } => {
                if let Some(uid) = user_id {
                    let _ = state.sfu_tx.send(SfuCommand::Deafen {
                        user_id: uid,
                        deafened,
                    });
                }
            }
        }
    }

    // Cleanup: leave room if still joined
    if let (Some(uid), true) = (user_id, joined) {
        let _ = state.sfu_tx.send(SfuCommand::Leave { user_id: uid });
        info!(user_id = %uid, "Voice WS disconnected, sent Leave");
    }

    send_task.abort();
}

/// JWT claims — must match the API server's token structure.
#[derive(Debug, Deserialize)]
struct Claims {
    sub: Uuid,
    #[allow(dead_code)]
    exp: i64,
}

fn validate_jwt(secret: &str, token: &str) -> Result<Claims, String> {
    let key = jsonwebtoken::DecodingKey::from_secret(secret.as_bytes());
    let validation = jsonwebtoken::Validation::default();
    jsonwebtoken::decode::<Claims>(token, &key, &validation)
        .map(|data| data.claims)
        .map_err(|e| e.to_string())
}
