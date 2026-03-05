use sqlx::PgPool;
use tracing::{info, warn, error};
use uuid::Uuid;
use web_push::{
    ContentEncoding, IsahcWebPushClient, PartialVapidSignatureBuilder,
    SubscriptionInfo, WebPushClient, WebPushError, WebPushMessageBuilder,
    VapidSignatureBuilder,
};

use jolkr_db::repo::DeviceRepo;

use crate::ws::gateway::GatewayState;

/// Push notification service for sending Web Push notifications to offline users.
#[derive(Clone)]
pub struct PushService {
    pool: PgPool,
    gateway: GatewayState,
    vapid_builder: Option<PartialVapidSignatureBuilder>,
    client: Option<IsahcWebPushClient>,
    vapid_public_key: Option<String>,
    vapid_subject: String,
}

impl PushService {
    pub fn new(
        pool: PgPool,
        gateway: GatewayState,
        vapid_private_key: Option<String>,
        vapid_public_key: Option<String>,
        vapid_subject: String,
    ) -> Self {
        let (vapid_builder, client) = match vapid_private_key.as_deref().filter(|k| !k.is_empty()) {
            Some(key) => {
                match VapidSignatureBuilder::from_base64_no_sub(key) {
                    Ok(builder) => {
                        match IsahcWebPushClient::new() {
                            Ok(c) => {
                                info!("Push notification service initialized with VAPID keys");
                                (Some(builder), Some(c))
                            }
                            Err(e) => {
                                error!("Failed to create Web Push client: {}", e);
                                (None, None)
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to parse VAPID private key: {}", e);
                        (None, None)
                    }
                }
            }
            None => {
                info!("Push notification service initialized (VAPID not configured, push disabled)");
                (None, None)
            }
        };

        Self {
            pool,
            gateway,
            vapid_builder,
            client,
            vapid_public_key,
            vapid_subject,
        }
    }

    /// Get the VAPID public key for client-side subscription.
    pub fn vapid_public_key(&self) -> Option<&str> {
        self.vapid_public_key.as_deref()
    }

    /// Check if a user has any active WebSocket connections.
    pub fn is_user_online(&self, user_id: Uuid) -> bool {
        self.gateway
            .clients
            .iter()
            .any(|entry| entry.value().user_id == user_id)
    }

    /// Send a push notification to all offline devices for a user.
    pub async fn notify_user(
        &self,
        user_id: Uuid,
        title: &str,
        body: &str,
        data: serde_json::Value,
    ) {
        // Skip if user is online (they'll get the event via WebSocket)
        if self.is_user_online(user_id) {
            return;
        }

        let (vapid_builder, client) = match (&self.vapid_builder, &self.client) {
            (Some(v), Some(c)) => (v, c),
            _ => {
                warn!(
                    user_id = %user_id,
                    title = title,
                    "Push notification skipped (VAPID not configured)"
                );
                return;
            }
        };

        // Get all devices with push tokens
        let devices = match DeviceRepo::get_pushable_devices(&self.pool, user_id).await {
            Ok(d) => d,
            Err(e) => {
                error!(user_id = %user_id, error = %e, "Failed to get pushable devices");
                return;
            }
        };

        if devices.is_empty() {
            return;
        }

        let payload = serde_json::json!({
            "title": title,
            "body": body,
            "data": data,
            "tag": format!("jolkr-{}", data.get("type").and_then(|v| v.as_str()).unwrap_or("msg")),
        });
        let payload_bytes = payload.to_string().into_bytes();

        for device in &devices {
            if let Some(ref token) = device.push_token {
                // Deserialize the stored subscription JSON
                let subscription: SubscriptionInfo = match serde_json::from_str(token) {
                    Ok(s) => s,
                    Err(e) => {
                        warn!(
                            device_id = %device.id,
                            error = %e,
                            "Invalid push subscription JSON, skipping"
                        );
                        continue;
                    }
                };

                // Build VAPID signature for this subscription
                let mut sig_builder = vapid_builder.clone().add_sub_info(&subscription);
                sig_builder.add_claim("sub", &*self.vapid_subject);
                let signature = match sig_builder.build() {
                    Ok(s) => s,
                    Err(e) => {
                        error!(device_id = %device.id, error = %e, "Failed to build VAPID signature");
                        continue;
                    }
                };

                // Build the push message
                let mut builder = WebPushMessageBuilder::new(&subscription);
                builder.set_payload(ContentEncoding::Aes128Gcm, &payload_bytes);
                builder.set_vapid_signature(signature);

                let message = match builder.build() {
                    Ok(m) => m,
                    Err(e) => {
                        error!(device_id = %device.id, error = %e, "Failed to build push message");
                        continue;
                    }
                };

                // Send the push notification
                match client.send(message).await {
                    Ok(()) => {
                        info!(
                            user_id = %user_id,
                            device_id = %device.id,
                            "Push notification sent"
                        );
                    }
                    Err(WebPushError::EndpointNotFound(_)) | Err(WebPushError::EndpointNotValid(_)) => {
                        // Subscription expired or invalid — remove device
                        warn!(
                            device_id = %device.id,
                            user_id = %user_id,
                            "Push subscription expired, removing device"
                        );
                        if let Err(e) = DeviceRepo::delete(&self.pool, device.id, user_id).await {
                            error!(device_id = %device.id, error = %e, "Failed to delete expired device");
                        }
                    }
                    Err(e) => {
                        error!(
                            device_id = %device.id,
                            user_id = %user_id,
                            error = %e,
                            "Failed to send push notification"
                        );
                    }
                }
            }
        }
    }

    /// Notify a user about a new message.
    pub async fn notify_message(
        &self,
        recipient_id: Uuid,
        sender_name: &str,
        channel_name: &str,
        content: &str,
        channel_id: Uuid,
        message_id: Uuid,
    ) {
        let title = format!("{sender_name} in #{channel_name}");
        let body = truncate_utf8(content, 100);

        let data = serde_json::json!({
            "type": "message",
            "channel_id": channel_id.to_string(),
            "message_id": message_id.to_string(),
        });

        self.notify_user(recipient_id, &title, &body, data).await;
    }

    /// Notify a user about a new DM.
    pub async fn notify_dm(
        &self,
        recipient_id: Uuid,
        sender_name: &str,
        content: &str,
        dm_channel_id: Uuid,
    ) {
        let title = sender_name.to_string();
        let body = truncate_utf8(content, 100);

        let data = serde_json::json!({
            "type": "dm",
            "dm_channel_id": dm_channel_id.to_string(),
        });

        self.notify_user(recipient_id, &title, &body, data).await;
    }
}

/// Truncate a string to `max_chars` characters, UTF-8 safe. Appends "..." if truncated.
fn truncate_utf8(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}
