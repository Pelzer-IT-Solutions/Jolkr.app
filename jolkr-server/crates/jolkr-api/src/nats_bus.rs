use async_nats::Client;
use futures_util::StreamExt;
use tracing::{error, info};
use uuid::Uuid;

use crate::ws::events::GatewayEvent;
use crate::ws::gateway::GatewayState;

/// NATS subject prefixes for event routing.
const SUBJECT_CHANNEL: &str = "jolkr.channel"; // jolkr.channel.{channel_id}
const SUBJECT_SERVER: &str = "jolkr.server"; // jolkr.server.{server_id}
const SUBJECT_PRESENCE: &str = "jolkr.presence"; // jolkr.presence (broadcast)
const SUBJECT_USER: &str = "jolkr.user"; // jolkr.user.{user_id}

/// A thin wrapper around the async-nats client for publishing gateway events.
#[derive(Clone)]
pub struct NatsBus {
    client: Client,
}

impl NatsBus {
    /// Connect to the NATS server.
    pub async fn connect(nats_url: &str) -> Result<Self, async_nats::ConnectError> {
        let client = async_nats::connect(nats_url).await?;
        info!("Connected to NATS at {nats_url}");
        Ok(Self { client })
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

    async fn publish(&self, subject: &str, event: &GatewayEvent) {
        let payload = match serde_json::to_vec(event) {
            Ok(p) => p,
            Err(e) => {
                error!("Failed to serialize event for NATS: {e}");
                return;
            }
        };
        if let Err(e) = self.client.publish(subject.to_string(), payload.into()).await {
            error!("Failed to publish to NATS subject {subject}: {e}");
        }
    }

    /// Subscribe to all relevant NATS subjects and forward events to the local gateway.
    /// This spawns a background Tokio task; call once at startup.
    pub fn spawn_subscriber(&self, gateway: GatewayState) {
        let client = self.client.clone();
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

            info!("NATS event subscriber started");

            loop {
                tokio::select! {
                    Some(msg) = channel_sub.next() => {
                        // Extract channel_id from subject: jolkr.channel.{uuid}
                        if let Some(channel_id_str) = msg.subject.as_str().strip_prefix("jolkr.channel.") {
                            if let Ok(channel_id) = Uuid::parse_str(channel_id_str) {
                                if let Ok(event) = serde_json::from_slice::<GatewayEvent>(&msg.payload) {
                                    gateway.broadcast_to_channel(channel_id, &event);
                                }
                            }
                        }
                    }
                    Some(msg) = server_sub.next() => {
                        // Extract server_id from subject: jolkr.server.{uuid}
                        if let Some(server_id_str) = msg.subject.as_str().strip_prefix("jolkr.server.") {
                            if let Ok(server_id) = Uuid::parse_str(server_id_str) {
                                if let Ok(event) = serde_json::from_slice::<GatewayEvent>(&msg.payload) {
                                    gateway.broadcast_to_server(server_id, &event);
                                }
                            }
                        }
                    }
                    Some(msg) = presence_sub.next() => {
                        if let Ok(event) = serde_json::from_slice::<GatewayEvent>(&msg.payload) {
                            gateway.broadcast_all(&event);
                        }
                    }
                    Some(msg) = user_sub.next() => {
                        // Extract user_id from subject: jolkr.user.{uuid}
                        if let Some(user_id_str) = msg.subject.as_str().strip_prefix("jolkr.user.") {
                            if let Ok(user_id) = Uuid::parse_str(user_id_str) {
                                if let Ok(event) = serde_json::from_slice::<GatewayEvent>(&msg.payload) {
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
