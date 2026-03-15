use async_nats::Client;
use futures_util::StreamExt;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::ws::events::GatewayEvent;
use crate::ws::gateway::GatewayState;

type HmacSha256 = Hmac<Sha256>;

/// NATS subject prefixes for event routing.
const SUBJECT_CHANNEL: &str = "jolkr.channel"; // jolkr.channel.{channel_id}
const SUBJECT_SERVER: &str = "jolkr.server"; // jolkr.server.{server_id}
const SUBJECT_PRESENCE: &str = "jolkr.presence"; // jolkr.presence (broadcast)
const SUBJECT_USER: &str = "jolkr.user"; // jolkr.user.{user_id}

/// A thin wrapper around the async-nats client for publishing gateway events.
/// All events are HMAC-SHA256 signed before publishing and verified on receive.
#[derive(Clone)]
pub struct NatsBus {
    client: Client,
    hmac_secret: Vec<u8>,
}

impl NatsBus {
    /// Connect to the NATS server, optionally with user/password authentication.
    pub async fn connect(
        nats_url: &str,
        hmac_secret: &str,
        user: Option<&str>,
        password: Option<&str>,
    ) -> Result<Self, async_nats::ConnectError> {
        let client = match (user, password) {
            (Some(u), Some(p)) => {
                let opts = async_nats::ConnectOptions::with_user_and_password(
                    u.to_string(),
                    p.to_string(),
                );
                opts.connect(nats_url).await?
            }
            _ => async_nats::connect(nats_url).await?,
        };
        info!("Connected to NATS at {nats_url}");
        Ok(Self {
            client,
            hmac_secret: hmac_secret.as_bytes().to_vec(),
        })
    }

    /// Check NATS connection state.
    pub fn connection_state(&self) -> async_nats::connection::State {
        self.client.connection_state()
    }

    /// Publish an event to all subscribers of a specific channel.
    pub async fn publish_to_channel(&self, channel_id: Uuid, event: &GatewayEvent) {
        let subject = format!("{SUBJECT_CHANNEL}.{channel_id}");
        self.publish(&subject, event).await;
    }

    /// Publish an event to all members of a server (channel CRUD, member changes, etc.).
    pub async fn publish_to_server(&self, server_id: Uuid, event: &GatewayEvent) {
        let subject = format!("{SUBJECT_SERVER}.{server_id}");
        self.publish(&subject, event).await;
    }

    /// Publish a presence event to all instances.
    pub async fn publish_presence(&self, event: &GatewayEvent) {
        self.publish(SUBJECT_PRESENCE, event).await;
    }

    /// Publish an event targeted at a specific user (all their devices/sessions).
    pub async fn publish_to_user(&self, user_id: Uuid, event: &GatewayEvent) {
        let subject = format!("{SUBJECT_USER}.{user_id}");
        self.publish(&subject, event).await;
    }

    /// Serialize event, sign with HMAC-SHA256, and publish as [sig:32][json:...].
    async fn publish(&self, subject: &str, event: &GatewayEvent) {
        let json = match serde_json::to_vec(event) {
            Ok(p) => p,
            Err(e) => {
                error!("Failed to serialize event for NATS: {e}");
                return;
            }
        };

        let signature = self.sign(&json);

        // Wire format: [32-byte HMAC signature][JSON payload]
        let mut signed = Vec::with_capacity(32 + json.len());
        signed.extend_from_slice(&signature);
        signed.extend_from_slice(&json);

        if let Err(e) = self.client.publish(subject.to_string(), signed.into()).await {
            error!("Failed to publish to NATS subject {subject}: {e}");
        }
    }

    /// Compute HMAC-SHA256 over the given data.
    fn sign(&self, data: &[u8]) -> [u8; 32] {
        let mut mac = HmacSha256::new_from_slice(&self.hmac_secret)
            .expect("HMAC accepts any key size");
        mac.update(data);
        mac.finalize().into_bytes().into()
    }

    /// Subscribe to all relevant NATS subjects and forward verified events to the local gateway.
    /// This spawns a background Tokio task; call once at startup.
    pub fn spawn_subscriber(&self, gateway: GatewayState) {
        let client = self.client.clone();
        let hmac_secret = self.hmac_secret.clone();
        tokio::spawn(async move {
            // Subscribe to wildcard subjects
            let mut channel_sub = match client.subscribe("jolkr.channel.*").await {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to subscribe to channel events: {e}");
                    return;
                }
            };
            let mut server_sub = match client.subscribe("jolkr.server.*").await {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to subscribe to server events: {e}");
                    return;
                }
            };
            let mut presence_sub = match client.subscribe("jolkr.presence").await {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to subscribe to presence events: {e}");
                    return;
                }
            };
            let mut user_sub = match client.subscribe("jolkr.user.*").await {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to subscribe to user events: {e}");
                    return;
                }
            };

            info!("NATS event subscriber started (HMAC verification enabled)");

            loop {
                tokio::select! {
                    Some(msg) = channel_sub.next() => {
                        if let Some(channel_id_str) = msg.subject.as_str().strip_prefix("jolkr.channel.") {
                            if let Ok(channel_id) = Uuid::parse_str(channel_id_str) {
                                if let Some(event) = verify_and_parse(&hmac_secret, &msg.payload) {
                                    gateway.broadcast_to_channel(channel_id, &event);
                                }
                            }
                        }
                    }
                    Some(msg) = server_sub.next() => {
                        if let Some(server_id_str) = msg.subject.as_str().strip_prefix("jolkr.server.") {
                            if let Ok(server_id) = Uuid::parse_str(server_id_str) {
                                if let Some(event) = verify_and_parse(&hmac_secret, &msg.payload) {
                                    gateway.broadcast_to_server(server_id, &event);
                                }
                            }
                        }
                    }
                    Some(msg) = presence_sub.next() => {
                        if let Some(event) = verify_and_parse(&hmac_secret, &msg.payload) {
                            gateway.broadcast_all(&event);
                        }
                    }
                    Some(msg) = user_sub.next() => {
                        if let Some(user_id_str) = msg.subject.as_str().strip_prefix("jolkr.user.") {
                            if let Ok(user_id) = Uuid::parse_str(user_id_str) {
                                if let Some(event) = verify_and_parse(&hmac_secret, &msg.payload) {
                                    gateway.broadcast_to_user(user_id, &event);
                                }
                            }
                        }
                    }
                    else => break,
                }
            }

            info!("NATS event subscriber stopped");
        });
    }
}

/// Verify HMAC-SHA256 signature and parse the JSON payload.
/// Wire format: [32-byte signature][JSON bytes]
fn verify_and_parse(secret: &[u8], data: &[u8]) -> Option<GatewayEvent> {
    if data.len() < 33 {
        warn!("NATS: message too short for HMAC verification ({} bytes)", data.len());
        return None;
    }
    let (sig, json) = data.split_at(32);

    let mut mac = match HmacSha256::new_from_slice(secret) {
        Ok(m) => m,
        Err(_) => return None,
    };
    mac.update(json);
    if mac.verify_slice(sig).is_err() {
        warn!("NATS: HMAC verification failed — rejecting event");
        return None;
    }

    match serde_json::from_slice(json) {
        Ok(event) => Some(event),
        Err(e) => {
            warn!("NATS: valid signature but failed to parse event: {e}");
            None
        }
    }
}
