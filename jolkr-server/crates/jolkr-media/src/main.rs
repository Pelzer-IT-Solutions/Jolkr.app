//! Jolkr media gateway (SFU): WebRTC signaling and forwarding for voice/video rooms.
#![expect(
    tail_expr_drop_order,
    reason = "Edition-2024 drop-order audit: tail expressions involve awaited futures and message-bus sends; destructors observed are benign. Will be revisited during the 2024 edition migration."
)]
use core::net::SocketAddr;
use std::sync::mpsc;

use axum::{routing::get, Json, Router};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;

mod config;
mod rooms;
mod signaling;
mod sfu;

use config::Config;
use rooms::{RoomInfo, RoomList};
use signaling::{ws_voice_upgrade, VoiceState};
use sfu::types::SfuCommand;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env();
    info!("Jolkr Media Server starting...");
    info!(
        "HTTP port: {}, UDP port: {}, public IP: {}, local IP: {:?}",
        config.http_port, config.udp_port, config.public_ip, config.local_ip
    );

    // ── Shared state ────────────────────────────────────────────────────
    let room_list = RoomList::new();

    // ── SFU command channel ─────────────────────────────────────────────
    let (sfu_tx, sfu_rx): (mpsc::Sender<SfuCommand>, mpsc::Receiver<SfuCommand>) =
        mpsc::channel();

    // ── UDP socket for WebRTC media ─────────────────────────────────────
    let udp_addr: SocketAddr = format!("0.0.0.0:{}", config.udp_port)
        .parse()
        .expect("Invalid UDP address");
    let udp_socket =
        std::net::UdpSocket::bind(udp_addr).expect("Failed to bind WebRTC UDP socket");
    info!("WebRTC UDP socket bound to {}", udp_addr);

    // Build ICE candidate addresses — public + optional LAN IP.
    // Both are advertised so ICE works for local and remote clients.
    let mut ice_addrs: Vec<SocketAddr> = Vec::new();
    if config.public_ip != "0.0.0.0" {
        ice_addrs.push(
            format!("{}:{}", config.public_ip, config.udp_port)
                .parse()
                .expect("Invalid PUBLIC_IP"),
        );
    }
    if let Some(ref local_ip) = config.local_ip {
        ice_addrs.push(
            format!("{}:{}", local_ip, config.udp_port)
                .parse()
                .expect("Invalid LOCAL_IP"),
        );
    }
    if ice_addrs.is_empty() {
        ice_addrs.push(udp_addr);
    }

    // ── Start the SFU thread ────────────────────────────────────────────
    let sfu_room_list = room_list.clone();
    std::thread::Builder::new()
        .name("sfu-media-loop".into())
        .spawn(move || {
            sfu::run_sfu(udp_socket, sfu_rx, ice_addrs, sfu_room_list);
        })
        .expect("Failed to spawn SFU thread");

    // ── Voice WebSocket state ───────────────────────────────────────────
    let voice_state = VoiceState {
        sfu_tx,
        jwt_secret: config.jwt_secret,
    };

    // ── Axum HTTP/WS server ─────────────────────────────────────────────
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/rooms", get({
            let rl = room_list.clone();
            move || list_rooms(rl.clone())
        }))
        .route("/ws/voice", get(ws_voice_upgrade))
        .with_state(voice_state);

    let http_addr = SocketAddr::from(([0, 0, 0, 0], config.http_port));
    info!("Media server HTTP listening on {}", http_addr);

    let listener = TcpListener::bind(http_addr)
        .await
        .expect("Failed to bind HTTP listener");

    axum::serve(listener, app.into_make_service())
        .await
        .expect("Media server error");
}

async fn health() -> &'static str {
    "ok"
}

async fn list_rooms(room_list: RoomList) -> Json<Vec<RoomInfo>> {
    Json(room_list.list())
}
