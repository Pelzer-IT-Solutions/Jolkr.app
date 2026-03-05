use std::collections::HashSet;
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::mpsc;
use tracing::{info, warn};
use uuid::Uuid;

use super::events::GatewayEvent;

/// Per-connection state tracked by the gateway.
#[derive(Debug)]
pub struct ConnectedClient {
    pub user_id: Uuid,
    pub session_id: Uuid,
    /// Channels this client is subscribed to.
    pub subscribed_channels: HashSet<Uuid>,
    /// Servers this client is a member of (auto-subscribed on Identify).
    pub subscribed_servers: HashSet<Uuid>,
    /// Sender half for pushing events to the client's WebSocket write loop.
    pub tx: mpsc::UnboundedSender<GatewayEvent>,
}

/// Shared gateway state, holding all connected clients.
///
/// The `DashMap` key is the session_id (unique per WebSocket connection).
#[derive(Clone)]
pub struct GatewayState {
    pub clients: Arc<DashMap<Uuid, ConnectedClient>>,
}

impl GatewayState {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(DashMap::new()),
        }
    }

    /// Register a newly authenticated client.
    pub fn add_client(
        &self,
        session_id: Uuid,
        user_id: Uuid,
        tx: mpsc::UnboundedSender<GatewayEvent>,
    ) {
        info!(session_id = %session_id, user_id = %user_id, "Client connected to gateway");
        self.clients.insert(
            session_id,
            ConnectedClient {
                user_id,
                session_id,
                subscribed_channels: HashSet::new(),
                subscribed_servers: HashSet::new(),
                tx,
            },
        );
    }

    /// Remove a client when they disconnect.
    pub fn remove_client(&self, session_id: &Uuid) {
        if self.clients.remove(session_id).is_some() {
            info!(session_id = %session_id, "Client disconnected from gateway");
        }
    }

    /// Subscribe a client to a channel's events.
    pub fn subscribe(&self, session_id: &Uuid, channel_id: Uuid) {
        if let Some(mut client) = self.clients.get_mut(session_id) {
            client.subscribed_channels.insert(channel_id);
        }
    }

    /// Unsubscribe a client from a channel's events.
    pub fn unsubscribe(&self, session_id: &Uuid, channel_id: Uuid) {
        if let Some(mut client) = self.clients.get_mut(session_id) {
            client.subscribed_channels.remove(&channel_id);
        }
    }

    /// Subscribe a client to a set of servers (called on Identify with user's server memberships).
    pub fn subscribe_servers(&self, session_id: &Uuid, server_ids: Vec<Uuid>) {
        if let Some(mut client) = self.clients.get_mut(session_id) {
            client.subscribed_servers.extend(server_ids);
        }
    }

    /// Add a single server subscription (e.g. after joining via invite).
    pub fn subscribe_server(&self, session_id: &Uuid, server_id: Uuid) {
        if let Some(mut client) = self.clients.get_mut(session_id) {
            client.subscribed_servers.insert(server_id);
        }
    }

    /// Remove a server subscription (e.g. after leaving/kicked/banned).
    pub fn unsubscribe_server(&self, session_id: &Uuid, server_id: Uuid) {
        if let Some(mut client) = self.clients.get_mut(session_id) {
            client.subscribed_servers.remove(&server_id);
        }
    }

    /// Revoke a user's server subscription across all their sessions (e.g. on kick/ban).
    pub fn revoke_server_for_user(&self, user_id: Uuid, server_id: Uuid) {
        for mut entry in self.clients.iter_mut() {
            let client = entry.value_mut();
            if client.user_id == user_id {
                client.subscribed_servers.remove(&server_id);
                // Also remove any channel subscriptions for that server
                // (channels will be checked on next subscribe anyway)
            }
        }
    }

    /// Broadcast an event to all clients that are members of a given server.
    pub fn broadcast_to_server(&self, server_id: Uuid, event: &GatewayEvent) {
        for entry in self.clients.iter() {
            let client = entry.value();
            if client.subscribed_servers.contains(&server_id) {
                if client.tx.send(event.clone()).is_err() {
                    warn!(
                        session_id = %client.session_id,
                        "Failed to send server event to client (channel closed)"
                    );
                }
            }
        }
    }

    /// Broadcast an event to all clients subscribed to a given channel.
    pub fn broadcast_to_channel(&self, channel_id: Uuid, event: &GatewayEvent) {
        for entry in self.clients.iter() {
            let client = entry.value();
            if client.subscribed_channels.contains(&channel_id) {
                if client.tx.send(event.clone()).is_err() {
                    warn!(
                        session_id = %client.session_id,
                        "Failed to send event to client (channel closed)"
                    );
                }
            }
        }
    }

    /// Broadcast an event to all clients associated with a specific user.
    pub fn broadcast_to_user(&self, user_id: Uuid, event: &GatewayEvent) {
        for entry in self.clients.iter() {
            let client = entry.value();
            if client.user_id == user_id {
                let _ = client.tx.send(event.clone());
            }
        }
    }

    /// Broadcast an event to every connected client.
    #[allow(dead_code)]
    pub fn broadcast_all(&self, event: &GatewayEvent) {
        for entry in self.clients.iter() {
            let _ = entry.value().tx.send(event.clone());
        }
    }

    /// Count total connected clients.
    #[allow(dead_code)]
    pub fn connected_count(&self) -> usize {
        self.clients.len()
    }
}

impl Default for GatewayState {
    fn default() -> Self {
        Self::new()
    }
}
