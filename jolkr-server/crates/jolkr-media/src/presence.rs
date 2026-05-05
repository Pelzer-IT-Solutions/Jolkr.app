//! Cross-service call-presence publisher.
//!
//! When a peer joins or leaves a server voice channel via the SFU, we publish
//! an HMAC-signed `UserCallPresence` event onto NATS subject
//! `jolkr.user.{user_id}`. The jolkr-api gateway's NATS subscriber verifies
//! the signature and forwards the event to all of that user's open WebSocket
//! sessions, which lets sibling devices show an "On a call" indicator.
//!
//! Wire format mirrors `crates/jolkr-api/src/nats_bus.rs`:
//!     [32-byte HMAC-SHA256 signature][JSON payload]
//!
//! The JSON shape mirrors `GatewayEvent::UserCallPresence` exactly (the
//! `GatewayEvent` enum uses `#[serde(tag = "op", content = "d")]`), so the
//! subscriber on the API side can parse it as if it had been published from
//! within jolkr-api itself.

use async_nats::Client;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use tracing::{error, info};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// Wire-compatible mirror of jolkr-api's `GatewayEvent::UserCallPresence`.
/// We only publish this single variant from the SFU, so we keep the enum
/// minimal — adding a variant on the API side does NOT require a change here.
#[derive(Serialize)]
#[serde(tag = "op", content = "d")]
enum WireEvent {
    UserCallPresence {
        dm_id: Option<Uuid>,
        channel_id: Option<Uuid>,
        is_video: Option<bool>,
    },
}

/// Publishes HMAC-signed call-presence events to NATS for the gateway to
/// fan out to a user's other sessions.
pub(crate) struct PresencePublisher {
    client: Client,
    hmac_secret: Vec<u8>,
}

impl PresencePublisher {
    /// Connect to NATS using user/password auth (mirrors `NatsBus::connect`).
    pub(crate) async fn connect(
        nats_url: &str,
        hmac_secret: &str,
        user: &str,
        password: &str,
    ) -> Result<Self, async_nats::ConnectError> {
        let opts = async_nats::ConnectOptions::with_user_and_password(
            user.to_string(),
            password.to_string(),
        );
        let client = opts.connect(nats_url).await?;
        info!("PresencePublisher: connected to NATS at {nats_url}");
        Ok(Self {
            client,
            hmac_secret: hmac_secret.as_bytes().to_vec(),
        })
    }

    /// Announce that `user_id` joined a server voice channel.
    pub(crate) async fn publish_voice_join(
        &self,
        user_id: Uuid,
        channel_id: Uuid,
        is_video: bool,
    ) {
        self.publish_user_event(
            user_id,
            &WireEvent::UserCallPresence {
                dm_id: None,
                channel_id: Some(channel_id),
                is_video: Some(is_video),
            },
        )
        .await;
    }

    /// Announce that `user_id` left a server voice channel (or any call).
    /// Both `dm_id` and `channel_id` are `None` to clear the indicator.
    pub(crate) async fn publish_voice_leave(&self, user_id: Uuid) {
        self.publish_user_event(
            user_id,
            &WireEvent::UserCallPresence {
                dm_id: None,
                channel_id: None,
                is_video: None,
            },
        )
        .await;
    }

    async fn publish_user_event(&self, user_id: Uuid, event: &WireEvent) {
        let json = match serde_json::to_vec(event) {
            Ok(p) => p,
            Err(e) => {
                error!("PresencePublisher: serialize failed: {e}");
                return;
            }
        };

        let mut mac = HmacSha256::new_from_slice(&self.hmac_secret)
            .expect("HMAC accepts any key size");
        mac.update(&json);
        let signature = mac.finalize().into_bytes();

        // Wire format: [32-byte signature][JSON payload]
        let mut signed = Vec::with_capacity(32 + json.len());
        signed.extend_from_slice(&signature);
        signed.extend_from_slice(&json);

        let subject = format!("jolkr.user.{user_id}");
        if let Err(e) = self.client.publish(subject, signed.into()).await {
            error!("PresencePublisher: NATS publish failed: {e}");
        }
    }
}
