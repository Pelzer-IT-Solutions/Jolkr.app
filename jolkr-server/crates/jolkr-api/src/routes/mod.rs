pub mod attachments;
pub mod health;
pub mod audit_log;
pub mod auth;
pub mod categories;
pub mod channel_encryption;
pub mod channels;
pub mod devices;
pub mod dms;
pub mod emojis;
pub mod friends;
pub mod invites;
pub mod keys;
pub mod messages;
pub mod notifications;
pub mod presence;
pub mod push;
pub mod polls;
pub mod reactions;
pub mod webhooks;
pub mod roles;
pub mod servers;
pub mod threads;
pub mod users;

use axum::{
    extract::{DefaultBodyLimit, Extension},
    middleware as axum_mw,
    routing::{get, put, post, patch, delete},
    Router,
};
use sqlx::PgPool;
use axum::http::{Method, HeaderName};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use std::time::Duration;

use metrics_exporter_prometheus::PrometheusHandle;

use crate::embed_service::LinkEmbedService;
use crate::email_service::EmailService;
use crate::middleware::metrics::metrics_middleware;
use crate::middleware::rate_limit::{rate_limit_middleware, RateLimiter};
use crate::nats_bus::NatsBus;
use crate::push_service::PushService;
use crate::redis_store::RedisStore;
use crate::storage::Storage;
use crate::ws;

/// Shared application state passed to all handlers.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt_secret: String,
    pub gateway: ws::gateway::GatewayState,
    pub redis: RedisStore,
    pub nats: NatsBus,
    pub storage: Storage,
    pub push: PushService,
    pub email: EmailService,
    pub embed: LinkEmbedService,
    pub app_url: String,
}

/// Build the complete Axum router with all route groups.
pub fn create_router(state: AppState, prometheus_handle: PrometheusHandle) -> Router {
    let redis = Some(state.redis.clone());
    // Read CORS origins from env var (comma-separated). Fall back to localhost for dev.
    let cors_origin = match std::env::var("CORS_ORIGINS") {
        Ok(origins) if !origins.is_empty() => {
            let parsed: Vec<axum::http::HeaderValue> = origins
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            AllowOrigin::list(parsed)
        }
        _ => {
            tracing::warn!("CORS_ORIGINS not set — defaulting to localhost dev origins");
            AllowOrigin::list(vec![
                "http://localhost:1420".parse().unwrap(),
                "http://localhost".parse().unwrap(),
                "https://tauri.localhost".parse().unwrap(),
            ])
        }
    };
    let cors = CorsLayer::new()
        .allow_origin(cors_origin)
        .allow_methods([
            Method::GET, Method::POST, Method::PUT,
            Method::PATCH, Method::DELETE, Method::OPTIONS,
        ])
        .allow_headers([
            HeaderName::from_static("authorization"),
            HeaderName::from_static("content-type"),
            HeaderName::from_static("accept"),
        ]);

    // Rate limiters: auth = strict (2/s), API = standard (30/s), webhook = moderate (10/s)
    // Distributed via Redis with local DashMap fallback
    let auth_limiter = RateLimiter::new("auth", 5, 2.0, redis.clone());
    let api_limiter = RateLimiter::new("api", 60, 30.0, redis.clone());
    let webhook_limiter = RateLimiter::new("webhook", 20, 10.0, redis);

    // Spawn background cleanup tasks to prevent memory leaks from stale entries
    auth_limiter.spawn_cleanup();
    api_limiter.spawn_cleanup();
    webhook_limiter.spawn_cleanup();

    // Auth routes with strict rate limiting
    // Layer order: last added = outermost (runs first)
    // Extension must be outer so rate_limit_middleware can extract it
    let auth_routes = Router::new()
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/refresh", post(auth::refresh))
        .route("/api/auth/reset-password", post(auth::reset_password))
        .route("/api/auth/forgot-password", post(auth::forgot_password))
        .route("/api/auth/reset-password-confirm", post(auth::reset_password_confirm))
        .layer(axum_mw::from_fn(rate_limit_middleware))
        .layer(Extension(auth_limiter));

    // All other API routes with standard rate limiting
    let api_routes = Router::new()
        // ── Auth (authenticated) ──────────────────────────────────
        .route("/api/auth/change-password", post(auth::change_password))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/logout-all", post(auth::logout_all))
        // ── Users ───────────────────────────────────────────────────
        .route("/api/users/@me", get(users::get_me).patch(users::update_me))
        .route("/api/users/batch", post(users::get_users_batch))
        .route("/api/users/:id", get(users::get_user))
        .route("/api/users/search", get(users::search_users))
        // ── Friends ─────────────────────────────────────────────────
        .route("/api/friends", get(friends::list_friends).post(friends::send_request))
        .route("/api/friends/pending", get(friends::list_pending))
        .route("/api/friends/:id/accept", post(friends::accept_request))
        .route("/api/friends/:id", delete(friends::decline_or_remove))
        .route("/api/friends/block", post(friends::block_user))
        // ── DMs ─────────────────────────────────────────────────────
        .route("/api/dms", get(dms::list_dms).post(dms::create_dm))
        .route("/api/dms/:dm_id", patch(dms::update_dm))
        .route("/api/dms/:dm_id/members", put(dms::add_dm_member))
        .route("/api/dms/:dm_id/members/@me", delete(dms::leave_dm))
        .route("/api/dms/:dm_id/close", post(dms::close_dm))
        .route(
            "/api/dms/:dm_id/messages",
            get(dms::get_dm_messages).post(dms::send_dm_message),
        )
        .route(
            "/api/dms/messages/:id",
            patch(dms::edit_dm_message).delete(dms::delete_dm_message),
        )
        .route(
            "/api/dms/messages/:id/reactions",
            get(dms::list_dm_reactions).post(dms::add_dm_reaction),
        )
        .route(
            "/api/dms/messages/:id/reactions/:emoji",
            delete(dms::remove_dm_reaction),
        )
        .route(
            "/api/dms/:dm_id/messages/:message_id/attachments",
            post(dms::upload_dm_attachment),
        )
        .route("/api/dms/:dm_id/read", post(dms::mark_as_read))
        .route(
            "/api/dms/:dm_id/pins/:message_id",
            post(dms::pin_dm_message).delete(dms::unpin_dm_message),
        )
        .route("/api/dms/:dm_id/pins", get(dms::list_dm_pins))
        .route("/api/dms/:dm_id/e2ee/distribute", post(channel_encryption::dm_distribute_keys))
        .route("/api/dms/:dm_id/e2ee/my-key", get(channel_encryption::dm_get_my_key))
        .route("/api/dms/:dm_id/call", post(dms::initiate_call))
        .route("/api/dms/:dm_id/call/accept", post(dms::accept_call))
        .route("/api/dms/:dm_id/call/reject", post(dms::reject_call))
        .route("/api/dms/:dm_id/call/end", post(dms::end_call))
        // ── Servers ─────────────────────────────────────────────────
        .route("/api/users/@me/servers/reorder", put(servers::reorder_servers))
        .route("/api/servers", get(servers::list_servers).post(servers::create_server))
        .route("/api/servers/discover", get(servers::discover_servers))
        .route(
            "/api/servers/:id",
            get(servers::get_server)
                .patch(servers::update_server)
                .delete(servers::delete_server),
        )
        .route("/api/servers/:id/join", post(servers::join_public_server))
        .route("/api/servers/:id/members", get(servers::list_members))
        .route("/api/servers/:id/members/@me", delete(servers::leave_server))
        .route("/api/servers/:id/members/:user_id", delete(servers::kick_member))
        .route("/api/servers/:id/members/:user_id/nickname", patch(servers::set_nickname))
        .route(
            "/api/servers/:id/members/:user_id/timeout",
            post(servers::timeout_member).delete(servers::remove_timeout),
        )
        .route("/api/servers/:id/bans", get(servers::list_bans).post(servers::ban_member))
        .route("/api/servers/:id/bans/:user_id", delete(servers::unban_member))
        // ── Invites ─────────────────────────────────────────────────
        .route(
            "/api/servers/:server_id/invites",
            get(invites::list_invites).post(invites::create_invite),
        )
        .route("/api/servers/:server_id/invites/:invite_id", delete(invites::delete_invite))
        .route("/api/invites/:code", post(invites::use_invite))
        // ── Categories ────────────────────────────────────────────────
        .route(
            "/api/servers/:server_id/categories",
            get(categories::list_categories).post(categories::create_category),
        )
        .route(
            "/api/categories/:id",
            patch(categories::update_category).delete(categories::delete_category),
        )
        // ── Roles ─────────────────────────────────────────────────────
        .route(
            "/api/servers/:server_id/roles",
            get(roles::list_roles).post(roles::create_role),
        )
        .route(
            "/api/roles/:id",
            patch(roles::update_role).delete(roles::delete_role),
        )
        .route(
            "/api/servers/:server_id/roles/:role_id/members",
            put(roles::assign_role),
        )
        .route(
            "/api/servers/:server_id/roles/:role_id/members/:user_id",
            delete(roles::remove_role),
        )
        .route(
            "/api/servers/:server_id/members-with-roles",
            get(roles::list_members_with_roles),
        )
        .route(
            "/api/servers/:server_id/permissions/@me",
            get(roles::get_my_permissions),
        )
        // ── Emojis ──────────────────────────────────────────────────
        .route(
            "/api/servers/:server_id/emojis",
            get(emojis::list_emojis).post(emojis::upload_emoji),
        )
        .route("/api/emojis/:emoji_id", delete(emojis::delete_emoji))
        // ── Channels ────────────────────────────────────────────────
        .route(
            "/api/servers/:server_id/channels",
            post(channels::create_channel),
        )
        .route("/api/servers/:server_id/channels/list", get(channels::list_channels))
        .route("/api/servers/:server_id/channels/reorder", put(channels::reorder_channels))
        .route(
            "/api/channels/:id",
            get(channels::get_channel)
                .patch(channels::update_channel)
                .delete(channels::delete_channel),
        )
        .route("/api/channels/:id/permissions/@me", get(channels::get_my_channel_permissions))
        .route("/api/channels/:id/overwrites", get(channels::list_overwrites).put(channels::upsert_overwrite))
        .route("/api/channels/:id/overwrites/:target_type/:target_id", delete(channels::delete_overwrite))
        // ── Threads ─────────────────────────────────────────────────
        .route(
            "/api/channels/:channel_id/threads",
            get(threads::list_threads).post(threads::create_thread),
        )
        .route("/api/threads/:thread_id", get(threads::get_thread).patch(threads::update_thread))
        .route(
            "/api/threads/:thread_id/messages",
            get(threads::get_thread_messages).post(threads::send_thread_message),
        )
        // ── Messages ────────────────────────────────────────────────
        .route(
            "/api/channels/:id/messages",
            get(messages::get_messages).post(messages::send_message),
        )
        .route(
            "/api/channels/:id/messages/search",
            get(messages::search_messages),
        )
        .route(
            "/api/messages/:id",
            patch(messages::edit_message).delete(messages::delete_message),
        )
        // ── Pins ────────────────────────────────────────────────────
        .route(
            "/api/channels/:channel_id/pins/:message_id",
            post(messages::pin_message).delete(messages::unpin_message),
        )
        .route("/api/channels/:channel_id/pins", get(messages::list_pins))
        // ── Reactions ───────────────────────────────────────────────
        .route("/api/messages/:id/reactions", post(reactions::add_reaction).get(reactions::list_reactions))
        .route("/api/messages/:message_id/reactions/:emoji", delete(reactions::remove_reaction))
        // ── Channel E2EE ─────────────────────────────────────────────
        .route("/api/channels/:id/e2ee/distribute", post(channel_encryption::distribute_keys))
        .route("/api/channels/:id/e2ee/my-key", get(channel_encryption::get_my_key))
        .route("/api/channels/:id/e2ee/generation", get(channel_encryption::get_key_generation))
        // ── E2EE Keys ─────────────────────────────────────────────────
        .route("/api/keys/upload", post(keys::upload_prekeys))
        .route("/api/keys/count/:device_id", get(keys::get_prekey_count))
        .route("/api/keys/:user_id/:device_id", get(keys::get_prekey_bundle))
        .route("/api/keys/:user_id", get(keys::get_prekey_bundle_by_user))
        // ── Devices ────────────────────────────────────────────────
        .route("/api/devices", get(devices::list_devices).post(devices::register_device))
        .route(
            "/api/devices/:device_id",
            delete(devices::delete_device),
        )
        .route(
            "/api/devices/:device_id/push-token",
            patch(devices::update_push_token),
        )
        // ── Attachments ──────────────────────────────────────────────
        .route(
            "/api/channels/:channel_id/messages/:message_id/attachments",
            post(attachments::upload_attachment),
        )
        .route("/api/messages/:message_id/attachments", get(attachments::list_attachments))
        .route("/api/upload", post(attachments::upload_file))
        // ── Notification Settings ────────────────────────────────────
        .route("/api/users/me/notifications", get(notifications::list_notification_settings))
        .route(
            "/api/users/me/notifications/:target_type/:target_id",
            get(notifications::get_notification_setting)
                .put(notifications::update_notification_setting),
        )
        // ── Polls ──────────────────────────────────────────────────
        .route("/api/channels/:id/polls", post(polls::create_poll))
        .route("/api/polls/:id", get(polls::get_poll))
        .route("/api/polls/:id/vote", post(polls::vote_poll).delete(polls::unvote_poll))
        // ── Webhooks (management) ─────────────────────────────────
        .route(
            "/api/channels/:id/webhooks",
            get(webhooks::list_webhooks).post(webhooks::create_webhook),
        )
        .route(
            "/api/webhooks/:id",
            patch(webhooks::update_webhook).delete(webhooks::delete_webhook),
        )
        .route("/api/webhooks/:id/token", post(webhooks::regenerate_token))
        // ── Audit Log ───────────────────────────────────────────────
        .route("/api/servers/:server_id/audit-log", get(audit_log::get_audit_log))
        // ── Presence ──────────────────────────────────────────────────
        .route("/api/presence/query", post(presence::query_presence))
        // ── Push ────────────────────────────────────────────────────
        .route("/api/push/vapid-key", get(push::vapid_key))
        .layer(axum_mw::from_fn(rate_limit_middleware))
        .layer(Extension(api_limiter));

    // All HTTP routes get a 30s request timeout (WebSocket & health excluded)
    let timed_routes = Router::new()
        .merge(auth_routes)
        .merge(api_routes)
        // ── Webhook execution (unauthenticated, token-based, rate limited) ──
        .merge(
            Router::new()
                .route("/api/webhooks/:id/:token", post(webhooks::execute_webhook))
                .layer(axum_mw::from_fn(rate_limit_middleware))
                .layer(Extension(webhook_limiter))
        )
        .layer(TimeoutLayer::new(Duration::from_secs(30)));

    // Prometheus metrics endpoint (returns text/plain OpenMetrics format)
    let metrics_route = {
        let handle = prometheus_handle;
        Router::new().route(
            "/metrics",
            get(move || {
                let h = handle.clone();
                async move { h.render() }
            }),
        )
    };

    Router::new()
        .merge(timed_routes)
        // ── WebSocket gateway (no timeout, long-lived) ──────────────
        .route("/ws", get(ws::handler::ws_upgrade))
        // ── Health check (no timeout) ───────────────────────────────
        .route("/health", get(health::health_check))
        // ── Prometheus metrics ───────────────────────────────────────
        .merge(metrics_route)
        .layer(DefaultBodyLimit::max(26 * 1024 * 1024)) // 26 MB, matches nginx client_max_body_size
        .layer(axum_mw::from_fn(metrics_middleware))
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}
