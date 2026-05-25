use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use dashmap::DashMap;
use sqlx::PgPool;
use tokio::sync::mpsc;
use tracing::{info, warn};
use uuid::Uuid;

use jolkr_common::Permissions;
use jolkr_db::repo::{ChannelOverwriteRepo, MemberRepo, RoleRepo, ServerRepo};

use super::events::GatewayEvent;

/// Per-connection state tracked by the gateway.
#[derive(Debug)]
pub struct ConnectedClient {
    pub user_id: Uuid,
    pub session_id: Uuid,
    /// Channels this client is subscribed to.
    pub subscribed_channels: HashSet<Uuid>,
    /// channel_id → server_id for entries in `subscribed_channels` that belong
    /// to a server channel (DM channels are absent). Lets `revoke_server_for_user`
    /// drop stale channel subscriptions on kick/ban; otherwise the WS would keep
    /// receiving MessageCreate etc. until the client reconnects.
    pub channel_servers: HashMap<Uuid, Uuid>,
    /// Servers this client is a member of (auto-subscribed on Identify).
    pub subscribed_servers: HashSet<Uuid>,
    /// Sender half for pushing events to the client's WebSocket write loop.
    pub tx: mpsc::Sender<GatewayEvent>,
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
        tx: mpsc::Sender<GatewayEvent>,
    ) {
        info!(session_id = %session_id, user_id = %user_id, "Client connected to gateway");
        self.clients.insert(
            session_id,
            ConnectedClient {
                user_id,
                session_id,
                subscribed_channels: HashSet::new(),
                channel_servers: HashMap::new(),
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

    /// Subscribe a client to a channel's events. `server_id` is required for
    /// server channels so the subscription can be revoked on kick/ban; pass
    /// `None` for DM channels (no server scope).
    pub fn subscribe(&self, session_id: &Uuid, channel_id: Uuid, server_id: Option<Uuid>) {
        if let Some(mut client) = self.clients.get_mut(session_id) {
            client.subscribed_channels.insert(channel_id);
            if let Some(sid) = server_id {
                client.channel_servers.insert(channel_id, sid);
            }
        }
    }

    /// Unsubscribe a client from a channel's events.
    pub fn unsubscribe(&self, session_id: &Uuid, channel_id: Uuid) {
        if let Some(mut client) = self.clients.get_mut(session_id) {
            client.subscribed_channels.remove(&channel_id);
            client.channel_servers.remove(&channel_id);
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
    /// Also drops any channel subscriptions that belong to the revoked server so
    /// the still-open WS doesn't keep receiving MessageCreate / etc. from
    /// channels the user no longer has access to.
    pub fn revoke_server_for_user(&self, user_id: Uuid, server_id: Uuid) {
        for mut entry in self.clients.iter_mut() {
            let client = entry.value_mut();
            if client.user_id == user_id {
                client.subscribed_servers.remove(&server_id);
                let stale: Vec<Uuid> = client.channel_servers.iter()
                    .filter(|(_, &owning_server)| owning_server == server_id)
                    .map(|(&channel, _)| channel)
                    .collect();
                for channel in stale {
                    client.subscribed_channels.remove(&channel);
                    client.channel_servers.remove(&channel);
                }
            }
        }
    }

    /// Broadcast an event to all clients that are members of a given server.
    pub fn broadcast_to_server(&self, server_id: Uuid, event: &GatewayEvent) {
        for entry in self.clients.iter() {
            let client = entry.value();
            if client.subscribed_servers.contains(&server_id) {
                if let Err(e) = client.tx.try_send(event.clone()) {
                    warn!(
                        session_id = %client.session_id,
                        "Failed to send server event to client: {e}"
                    );
                }
            }
        }
    }

    /// Broadcast a channel-scoped event only to users who have `VIEW_CHANNELS`
    /// on the given channel. Used for ChannelCreate/Update/Delete and
    /// ChannelPermissionUpdate — server-wide broadcast leaks the channel name,
    /// topic, and permissions to users who shouldn't see the channel at all.
    ///
    /// Falls back to a full server broadcast on DB lookup failures: refusing to
    /// emit on a transient Redis/Postgres blip would break the legitimate
    /// recipients' UI more visibly than the leak would matter, and the safe
    /// payload shape (no body) of ChannelDelete makes over-broadcast acceptable.
    pub async fn broadcast_to_channel_visible(
        &self,
        server_id: Uuid,
        channel_id: Uuid,
        event: &GatewayEvent,
        pool: &PgPool,
    ) {
        let allowed = match Self::compute_allowed_user_ids(pool, server_id, channel_id).await {
            Some(set) => set,
            None => {
                // Lookup failed — log and fall back to existing server broadcast.
                self.broadcast_to_server(server_id, event);
                return;
            }
        };

        for entry in self.clients.iter() {
            let client = entry.value();
            if client.subscribed_servers.contains(&server_id) && allowed.contains(&client.user_id) {
                drop(client.tx.try_send(event.clone()));
            }
        }
    }

    /// Resolve the set of user_ids who currently have VIEW_CHANNELS on
    /// `channel_id`. Returns None if any required lookup failed — callers
    /// should treat that as "unknown" and choose a safe fallback.
    async fn compute_allowed_user_ids(
        pool: &PgPool,
        server_id: Uuid,
        channel_id: Uuid,
    ) -> Option<HashSet<Uuid>> {
        let members = match MemberRepo::list_for_server(pool, server_id).await {
            Ok(m) => m,
            Err(e) => {
                warn!(?e, %server_id, "broadcast_to_channel_visible: list_for_server failed");
                return None;
            }
        };
        let server = match ServerRepo::get_by_id(pool, server_id).await {
            Ok(s) => s,
            Err(e) => {
                warn!(?e, %server_id, "broadcast_to_channel_visible: get_by_id(server) failed");
                return None;
            }
        };
        let member_roles = RoleRepo::list_member_roles_batch(pool, server_id).await.unwrap_or_default();
        let overwrites = ChannelOverwriteRepo::list_for_channel(pool, channel_id).await.unwrap_or_default();
        let everyone_role = RoleRepo::get_default(pool, server_id).await.ok();

        let member_pairs: Vec<(Uuid, Uuid)> = members.iter().map(|m| (m.id, m.user_id)).collect();
        let perms_map = RoleRepo::compute_channel_permissions_for_all_members(
            &member_pairs,
            &member_roles,
            &overwrites,
            everyone_role.as_ref(),
            server.owner_id,
        );

        let allowed: HashSet<Uuid> = members
            .iter()
            .filter(|m| {
                let p = perms_map.get(&m.id).copied().unwrap_or(0);
                Permissions::from(p).has(Permissions::VIEW_CHANNELS)
            })
            .map(|m| m.user_id)
            .collect();
        Some(allowed)
    }

    /// Broadcast an event to all clients subscribed to a given channel.
    pub fn broadcast_to_channel(&self, channel_id: Uuid, event: &GatewayEvent) {
        for entry in self.clients.iter() {
            let client = entry.value();
            if client.subscribed_channels.contains(&channel_id) {
                if let Err(e) = client.tx.try_send(event.clone()) {
                    warn!(
                        session_id = %client.session_id,
                        "Failed to send event to client: {e}"
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
                drop(client.tx.try_send(event.clone()));
            }
        }
    }

    /// Broadcast an event to every connected client.
    pub fn broadcast_all(&self, event: &GatewayEvent) {
        for entry in self.clients.iter() {
            drop(entry.value().tx.try_send(event.clone()));
        }
    }
}

impl Default for GatewayState {
    fn default() -> Self {
        Self::new()
    }
}
