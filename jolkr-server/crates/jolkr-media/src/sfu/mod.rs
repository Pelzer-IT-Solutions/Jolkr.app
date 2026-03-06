//! Selective Forwarding Unit (SFU) — the media event loop.
//!
//! Runs on a dedicated OS thread. Owns all `str0m::Rtc` instances and
//! the shared UDP socket. Communicates with WebSocket handlers via channels.

pub mod types;

use std::collections::HashMap;
use std::io;
use std::net::{SocketAddr, UdpSocket};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, Input, Output, Rtc};
use str0m::change::{SdpAnswer, SdpPendingOffer};
use str0m::media::{Direction, MediaData, MediaKind, Mid};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::rooms::RoomList;
use types::{ParticipantInfo, SfuCommand, SignalOut};

/// A connected client in the SFU.
struct Client {
    user_id: Uuid,
    channel_id: Uuid,
    rtc: Rtc,
    signal_tx: tokio::sync::mpsc::UnboundedSender<SignalOut>,

    /// Mid that receives this client's audio (their microphone).
    #[allow(dead_code)]
    recv_mid: Option<Mid>,
    /// Mids used to send other clients' audio TO this client.
    /// Key: the other user's ID. Value: the Mid on THIS client's Rtc.
    send_mids: HashMap<Uuid, Mid>,
    /// Pending SDP offer waiting for the client's answer.
    pending: Option<SdpPendingOffer>,

    /// DTLS is only initialized after accept_answer(). Calling poll_output()
    /// before that panics in dimpl. We skip poll_output until this is true.
    dtls_ready: bool,

    is_muted: bool,
    is_deafened: bool,
}

impl Client {
    fn is_alive(&self) -> bool {
        self.rtc.is_alive() && !self.signal_tx.is_closed()
    }
}

/// Helper: call handle_timeout on an Rtc to satisfy dimpl's requirement.
/// Must be called before poll_output() and sdp_api().apply().
fn drive_time(rtc: &mut Rtc) {
    let _ = rtc.handle_input(Input::Timeout(Instant::now()));
}

/// Run the SFU event loop. This function blocks forever and should be
/// called on a dedicated `std::thread`.
pub fn run_sfu(
    udp_socket: UdpSocket,
    cmd_rx: mpsc::Receiver<SfuCommand>,
    local_addr: SocketAddr,
    room_list: RoomList,
) {
    info!("SFU media loop starting on UDP {}", local_addr);

    let mut clients: Vec<Client> = Vec::new();
    let mut buf = vec![0u8; 65535];

    udp_socket
        .set_read_timeout(Some(Duration::from_millis(50)))
        .expect("Failed to set UDP socket timeout");

    let mut room_sync_counter: u32 = 0;

    loop {
        let now = Instant::now();

        // ── 1. Remove dead clients ──────────────────────────────────────
        let mut dead: Vec<(Uuid, Uuid)> = Vec::new();
        clients.retain(|c| {
            if c.is_alive() {
                true
            } else {
                dead.push((c.user_id, c.channel_id));
                false
            }
        });
        for &(user_id, channel_id) in &dead {
            broadcast_to_room(&clients, channel_id, user_id, SignalOut::ParticipantLeft { user_id });
        }

        // ── 2. Process commands from WebSocket handlers ─────────────────
        while let Ok(cmd) = cmd_rx.try_recv() {
            // Catch panics from str0m/dimpl to keep the SFU thread alive
            let result = catch_unwind(AssertUnwindSafe(|| {
                handle_command(&mut clients, cmd, local_addr);
            }));
            if let Err(e) = result {
                error!("SFU handle_command panic caught: {:?}", e);
            }
        }

        // ── 3. Poll all Rtc instances for output ────────────────────────
        let mut propagations: Vec<(Uuid, Uuid, MediaData)> = Vec::new();
        let mut next_timeout = now + Duration::from_millis(100);
        let mut panicked_indices: Vec<usize> = Vec::new();

        for (idx, client) in clients.iter_mut().enumerate() {
            // Skip poll_output for clients awaiting SDP answer — dimpl panics
            // if poll_output is called before DTLS init (which happens in accept_answer).
            if !client.dtls_ready {
                continue;
            }

            let poll_result = catch_unwind(AssertUnwindSafe(|| {
                let mut props = Vec::new();
                let mut timeout = now + Duration::from_millis(100);
                loop {
                    drive_time(&mut client.rtc);
                    match client.rtc.poll_output() {
                        Ok(output) => match output {
                            Output::Transmit(t) => {
                                if let Err(e) = udp_socket.send_to(&t.contents, t.destination) {
                                    warn!("UDP send error for {}: {}", client.user_id, e);
                                }
                            }
                            Output::Event(event) => match event {
                                Event::IceConnectionStateChange(state) => {
                                    info!("ICE state for {}: {:?}", client.user_id, state);
                                }
                                Event::Connected => {
                                    info!("WebRTC connected: {}", client.user_id);
                                }
                                Event::MediaData(data) => {
                                    if !client.is_muted {
                                        props.push((
                                            client.user_id,
                                            client.channel_id,
                                            data,
                                        ));
                                    }
                                }
                                _ => {}
                            },
                            Output::Timeout(t) => {
                                timeout = t;
                                break;
                            }
                        },
                        Err(e) => {
                            error!("Rtc poll error for {}: {}", client.user_id, e);
                            break;
                        }
                    }
                }
                (props, timeout)
            }));

            match poll_result {
                Ok((props, timeout)) => {
                    propagations.extend(props);
                    if timeout < next_timeout {
                        next_timeout = timeout;
                    }
                }
                Err(e) => {
                    error!("poll_output panic for {}: {:?}", client.user_id, e);
                    panicked_indices.push(idx);
                }
            }
        }

        // Remove clients whose Rtc panicked (they're in a broken state)
        for &idx in panicked_indices.iter().rev() {
            let client = &clients[idx];
            warn!("Removing panicked client {}", client.user_id);
            let channel_id = client.channel_id;
            let user_id = client.user_id;
            clients.remove(idx);
            broadcast_to_room(&clients, channel_id, user_id, SignalOut::ParticipantLeft { user_id });
        }

        // ── 4. Forward media to other clients in the same room ──────────
        for (sender_id, channel_id, ref media) in &propagations {
            for client in clients.iter_mut() {
                if client.user_id == *sender_id
                    || client.channel_id != *channel_id
                    || client.is_deafened
                {
                    continue;
                }
                if let Some(&mid) = client.send_mids.get(sender_id) {
                    if let Some(writer) = client.rtc.writer(mid) {
                        if let Some(pt) = writer.match_params(media.params) {
                            let _ = writer.write(
                                pt,
                                media.network_time,
                                media.time,
                                media.data.clone(),
                            );
                        }
                    }
                }
            }
        }

        // ── 5. Read UDP socket ──────────────────────────────────────────
        match udp_socket.recv_from(&mut buf) {
            Ok((len, addr)) => {
                if let Ok(contents) = (&buf[..len]).try_into() {
                    let receive = Receive {
                        proto: Protocol::Udp,
                        source: addr,
                        destination: local_addr,
                        contents,
                    };

                    // Create Input to check which client owns this packet
                    let input = Input::Receive(Instant::now(), receive);
                    let target = clients
                        .iter()
                        .position(|c| c.rtc.accepts(&input));

                    if let Some(i) = target {
                        debug!("UDP packet from {} routed to {}", addr, clients[i].user_id);
                        if let Err(e) = clients[i].rtc.handle_input(input) {
                            warn!("Rtc input error for {}: {}", clients[i].user_id, e);
                        }
                    } else if !clients.is_empty() {
                        debug!("UDP packet from {} not accepted by any client ({} clients)", addr, clients.len());
                    }
                }
            }
            Err(e)
                if e.kind() == io::ErrorKind::WouldBlock
                    || e.kind() == io::ErrorKind::TimedOut =>
            {
                // Socket read timeout — drive Rtc timeouts
                let now = Instant::now();
                for client in clients.iter_mut() {
                    let _ = client.rtc.handle_input(Input::Timeout(now));
                }
            }
            Err(e) => {
                error!("UDP recv error: {}", e);
            }
        }

        // ── 6. Update socket timeout for next iteration ─────────────────
        let remaining = next_timeout.saturating_duration_since(Instant::now());
        let timeout = remaining.max(Duration::from_millis(1));
        let _ = udp_socket.set_read_timeout(Some(timeout));

        // ── 7. Periodically sync room state for REST API ────────────────
        room_sync_counter += 1;
        if room_sync_counter >= 100 {
            room_sync_counter = 0;
            sync_room_list(&clients, &room_list);
        }
    }
}

// ── Command handling ────────────────────────────────────────────────────

fn handle_command(clients: &mut Vec<Client>, cmd: SfuCommand, local_addr: SocketAddr) {
    match cmd {
        SfuCommand::AddPeer {
            user_id,
            channel_id,
            signal_tx,
        } => {
            // Prevent duplicate joins
            if clients.iter().any(|c| c.user_id == user_id) {
                let _ = signal_tx.send(SignalOut::Error {
                    message: "Already in a voice channel".into(),
                });
                return;
            }

            // Collect existing participants
            let existing: Vec<ParticipantInfo> = clients
                .iter()
                .filter(|c| c.channel_id == channel_id)
                .map(|c| ParticipantInfo {
                    user_id: c.user_id,
                    is_muted: c.is_muted,
                    is_deafened: c.is_deafened,
                })
                .collect();

            let existing_ids: Vec<Uuid> = existing.iter().map(|p| p.user_id).collect();

            // Create Rtc instance (ICE lite for server)
            let mut rtc = Rtc::builder()
                .set_ice_lite(true)
                .build(Instant::now());

            // Add the server's UDP address as a local ICE candidate
            if let Ok(candidate) = Candidate::host(local_addr, "udp") {
                let _ = rtc.add_local_candidate(candidate);
            }

            // dimpl requires handle_timeout before sdp_api().apply() / poll_output()
            drive_time(&mut rtc);

            // Build SDP offer:
            //   - 1x RecvOnly audio (receive client's microphone)
            //   - Nx SendOnly audio (send each existing participant's audio)
            let mut change = rtc.sdp_api();
            let recv_mid = change.add_media(
                MediaKind::Audio,
                Direction::RecvOnly,
                None,
                None,
                None,
            );

            let mut send_mids = HashMap::new();
            for &other_id in &existing_ids {
                let send_mid = change.add_media(
                    MediaKind::Audio,
                    Direction::SendOnly,
                    None,
                    None,
                    None,
                );
                send_mids.insert(other_id, send_mid);
            }

            match change.apply() {
                Some((offer, pending)) => {
                    // dimpl 0.2.7+ requires handle_timeout after apply()
                    drive_time(&mut rtc);

                    let offer_sdp = offer.to_sdp_string();

                    // Send Joined event with current participants
                    let _ = signal_tx.send(SignalOut::Joined {
                        room_id: channel_id,
                        participants: existing,
                    });

                    // Send the SDP offer
                    let _ = signal_tx.send(SignalOut::Offer { sdp: offer_sdp });

                    // Add client to the list (dtls_ready=false until answer received)
                    clients.push(Client {
                        user_id,
                        channel_id,
                        rtc,
                        signal_tx,
                        recv_mid: Some(recv_mid),
                        send_mids,
                        pending: Some(pending),
                        dtls_ready: false,
                        is_muted: false,
                        is_deafened: false,
                    });

                    // Notify existing participants
                    broadcast_to_room(
                        clients,
                        channel_id,
                        user_id,
                        SignalOut::ParticipantJoined { user_id },
                    );

                    // Re-negotiate with existing participants to add the new client's audio
                    renegotiate_for_new_peer(clients, channel_id, user_id);
                }
                None => {
                    error!("Failed to create SDP offer for {}: apply returned None", user_id);
                    let _ = signal_tx.send(SignalOut::Error {
                        message: "SDP offer creation failed".into(),
                    });
                }
            }
        }

        SfuCommand::Answer { user_id, sdp } => {
            if let Some(client) = clients.iter_mut().find(|c| c.user_id == user_id) {
                if let Some(pending) = client.pending.take() {
                    match SdpAnswer::from_sdp_string(&sdp) {
                        Ok(answer) => {
                            if let Err(e) = client.rtc.sdp_api().accept_answer(pending, answer) {
                                error!("Failed to accept answer from {}: {}", user_id, e);
                            } else {
                                // accept_answer calls init_dtls which sets dimpl's last_now.
                                // Now it's safe to call poll_output().
                                client.dtls_ready = true;
                                drive_time(&mut client.rtc);
                                debug!("Accepted SDP answer from {}", user_id);
                            }
                        }
                        Err(e) => {
                            error!("Invalid SDP answer from {}: {}", user_id, e);
                        }
                    }
                } else {
                    warn!("Answer from {} but no pending offer", user_id);
                }
            }
        }

        SfuCommand::IceCandidate { user_id, candidate } => {
            if let Some(client) = clients.iter_mut().find(|c| c.user_id == user_id) {
                match Candidate::from_sdp_string(&candidate) {
                    Ok(cand) => {
                        client.rtc.add_remote_candidate(cand);
                    }
                    Err(e) => {
                        warn!("Invalid ICE candidate from {}: {}", user_id, e);
                    }
                }
            }
        }

        SfuCommand::Leave { user_id } => {
            if let Some(idx) = clients.iter().position(|c| c.user_id == user_id) {
                let channel_id = clients[idx].channel_id;
                clients.remove(idx);
                info!("User {} left voice channel {}", user_id, channel_id);
                broadcast_to_room(
                    clients,
                    channel_id,
                    user_id,
                    SignalOut::ParticipantLeft { user_id },
                );
            }
        }

        SfuCommand::Mute { user_id, muted } => {
            if let Some(client) = clients.iter_mut().find(|c| c.user_id == user_id) {
                client.is_muted = muted;
                let channel_id = client.channel_id;
                broadcast_to_room(
                    clients,
                    channel_id,
                    user_id,
                    SignalOut::MuteUpdate { user_id, muted },
                );
            }
        }

        SfuCommand::Deafen { user_id, deafened } => {
            if let Some(client) = clients.iter_mut().find(|c| c.user_id == user_id) {
                client.is_deafened = deafened;
                let channel_id = client.channel_id;
                broadcast_to_room(
                    clients,
                    channel_id,
                    user_id,
                    SignalOut::DeafenUpdate { user_id, deafened },
                );
            }
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Re-negotiate with all existing participants in a channel so they receive
/// the new peer's audio.
fn renegotiate_for_new_peer(clients: &mut [Client], channel_id: Uuid, new_user_id: Uuid) {
    for client in clients.iter_mut() {
        if client.channel_id != channel_id || client.user_id == new_user_id {
            continue;
        }
        // Skip if there's already a pending negotiation
        if client.pending.is_some() {
            warn!(
                "Skipping re-negotiation for {} (already pending)",
                client.user_id
            );
            continue;
        }

        // dimpl requires handle_timeout before sdp_api().apply()
        drive_time(&mut client.rtc);

        // Add a SendOnly track for the new participant's audio
        let mut change = client.rtc.sdp_api();
        let send_mid = change.add_media(
            MediaKind::Audio,
            Direction::SendOnly,
            None,
            None,
            None,
        );
        client.send_mids.insert(new_user_id, send_mid);

        match change.apply() {
            Some((offer, pending)) => {
                // dimpl 0.2.7+ requires handle_timeout after apply()
                drive_time(&mut client.rtc);

                let offer_sdp = offer.to_sdp_string();
                client.pending = Some(pending);
                let _ = client.signal_tx.send(SignalOut::Offer { sdp: offer_sdp });
                debug!(
                    "Sent re-negotiation offer to {} for new peer {}",
                    client.user_id, new_user_id
                );
            }
            None => {
                error!(
                    "Re-negotiation failed for {}: apply returned None",
                    client.user_id
                );
            }
        }
    }
}

/// Broadcast a signaling event to all clients in a room except the sender.
fn broadcast_to_room(clients: &[Client], channel_id: Uuid, exclude: Uuid, event: SignalOut) {
    for client in clients {
        if client.channel_id == channel_id && client.user_id != exclude {
            let _ = client.signal_tx.send(event.clone());
        }
    }
}

/// Sync current room state to the shared RoomList for the REST API.
fn sync_room_list(clients: &[Client], room_list: &RoomList) {
    let mut rooms: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for client in clients {
        rooms
            .entry(client.channel_id)
            .or_default()
            .push(client.user_id);
    }

    let infos: Vec<crate::rooms::RoomInfo> = rooms
        .into_iter()
        .map(|(channel_id, participants)| crate::rooms::RoomInfo {
            channel_id,
            participant_count: participants.len(),
            participant_ids: participants,
        })
        .collect();

    room_list.update(infos);
}
