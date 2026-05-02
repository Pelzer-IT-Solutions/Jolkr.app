//! Selective Forwarding Unit (SFU) — the media event loop.
//!
//! Runs on a dedicated OS thread. Owns all `str0m::Rtc` instances and
//! the shared UDP socket. Communicates with WebSocket handlers via channels.

pub(crate) mod types;

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

/// Mids used to send another client's media TO this client (one per kind).
#[derive(Debug, Clone)]
struct PeerMids {
    audio: Mid,
    video: Option<Mid>,
}

/// A connected client in the SFU.
struct Client {
    user_id: Uuid,
    channel_id: Uuid,
    rtc: Rtc,
    signal_tx: tokio::sync::mpsc::UnboundedSender<SignalOut>,

    /// Whether this client negotiated to send/receive video.
    with_video: bool,

    /// Mid that receives this client's audio (their microphone).
    recv_audio_mid: Option<Mid>,
    /// Mid that receives this client's video (their camera). `None` if `with_video=false`.
    recv_video_mid: Option<Mid>,
    /// Mids used to send other clients' media TO this client (per kind).
    /// Key: the other user's ID. Value: that peer's audio + optional video Mid.
    send_mids: HashMap<Uuid, PeerMids>,
    /// Pending SDP offer waiting for the client's answer.
    pending: Option<SdpPendingOffer>,
    /// User IDs queued for re-negotiation (when a pending offer blocks immediate renegotiation).
    pending_renegotiations: Vec<Uuid>,

    /// DTLS is only initialized after `accept_answer()`. Calling `poll_output()`
    /// before that panics in dimpl. We skip `poll_output` until this is true.
    dtls_ready: bool,

    is_muted: bool,
    is_deafened: bool,
}

impl Client {
    fn is_alive(&self) -> bool {
        self.rtc.is_alive() && !self.signal_tx.is_closed()
    }
}

/// Helper: call `handle_timeout` on an Rtc to satisfy dimpl's requirement.
/// Must be called before `poll_output()` and `sdp_api().apply()`.
fn drive_time(rtc: &mut Rtc) {
    drop(rtc.handle_input(Input::Timeout(Instant::now())));
}

/// Run the SFU event loop. This function blocks forever and should be
/// called on a dedicated `std::thread`.
pub(crate) fn run_sfu(
    udp_socket: UdpSocket,
    cmd_rx: mpsc::Receiver<SfuCommand>,
    ice_addrs: Vec<SocketAddr>,
    room_list: RoomList,
) {
    info!("SFU media loop starting, ICE candidates: {:?}", ice_addrs);
    let _local_addr = ice_addrs[0];

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
                handle_command(&mut clients, cmd, &ice_addrs);
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
        for (sender_id, channel_id, media) in &propagations {
            // Determine kind by matching the source mid against the sender's
            // recv_audio_mid / recv_video_mid. Audio receivers ignore deafen,
            // video does not.
            let (is_video, source_kind_known) = clients
                .iter()
                .find(|c| c.user_id == *sender_id)
                .map(|sender| {
                    if Some(media.mid) == sender.recv_video_mid {
                        (true, true)
                    } else if Some(media.mid) == sender.recv_audio_mid {
                        (false, true)
                    } else {
                        (false, false)
                    }
                })
                .unwrap_or((false, false));

            if !source_kind_known {
                debug!("Media from {} on unknown mid {:?} ({} bytes) — skipping", sender_id, media.mid, media.data.len());
                continue;
            }

            debug!("Media from {} in channel {} ({} bytes, video={})", sender_id, channel_id, media.data.len(), is_video);

            for client in &mut clients {
                if client.user_id == *sender_id
                    || client.channel_id != *channel_id
                {
                    continue;
                }
                // Deafen suppresses audio only — video keeps flowing.
                if !is_video && client.is_deafened {
                    continue;
                }

                let target_mid = match client.send_mids.get(sender_id) {
                    Some(peer_mids) => {
                        if is_video {
                            peer_mids.video
                        } else {
                            Some(peer_mids.audio)
                        }
                    }
                    None => {
                        warn!("No send_mids for {} on target {} (have: {:?})", sender_id, client.user_id, client.send_mids.keys().collect::<Vec<_>>());
                        continue;
                    }
                };

                let Some(mid) = target_mid else {
                    // Receiver has no track of this kind for this sender — silently skip.
                    continue;
                };

                match client.rtc.writer(mid) { Some(writer) => {
                    if let Some(pt) = writer.match_params(media.params) {
                        drop(writer.write(
                            pt,
                            media.network_time,
                            media.time,
                            media.data.clone(),
                        ));
                    } else {
                        warn!("No matching codec params for {} -> {} (mid {:?}, video={})", sender_id, client.user_id, mid, is_video);
                    }
                } _ => {
                    warn!("No writer for mid {:?} on {} (forwarding from {}, video={})", mid, client.user_id, sender_id, is_video);
                }}
            }
        }

        // ── 5. Read UDP socket ──────────────────────────────────────────
        match udp_socket.recv_from(&mut buf) {
            Ok((len, addr)) => {
                // Try each ICE address as destination — clients connected via
                // different candidates (public vs LAN) need the matching destination.
                let mut handled = false;
                for &ice_addr in &ice_addrs {
                    if let Ok(contents) = (&buf[..len]).try_into() {
                        let receive = Receive {
                            proto: Protocol::Udp,
                            source: addr,
                            destination: ice_addr,
                            contents,
                        };
                        let input = Input::Receive(Instant::now(), receive);
                        let target = clients
                            .iter()
                            .position(|c| c.rtc.accepts(&input));

                        if let Some(i) = target {
                            debug!("UDP packet from {} routed to {} (via {})", addr, clients[i].user_id, ice_addr);
                            if let Err(e) = clients[i].rtc.handle_input(input) {
                                warn!("Rtc input error for {}: {}", clients[i].user_id, e);
                            }
                            handled = true;
                            break;
                        }
                    }
                }
                if !handled && !clients.is_empty() {
                    debug!("UDP packet from {} not accepted by any client ({} clients)", addr, clients.len());
                }
            }
            Err(e)
                if e.kind() == io::ErrorKind::WouldBlock
                    || e.kind() == io::ErrorKind::TimedOut =>
            {
                // Socket read timeout — drive Rtc timeouts
                let now = Instant::now();
                for client in &mut clients {
                    drop(client.rtc.handle_input(Input::Timeout(now)));
                }
            }
            Err(e) => {
                error!("UDP recv error: {}", e);
            }
        }

        // ── 6. Update socket timeout for next iteration ─────────────────
        let remaining = next_timeout.saturating_duration_since(Instant::now());
        let timeout = remaining.max(Duration::from_millis(1));
        drop(udp_socket.set_read_timeout(Some(timeout)));

        // ── 7. Periodically sync room state for REST API ────────────────
        room_sync_counter += 1;
        if room_sync_counter >= 100 {
            room_sync_counter = 0;
            sync_room_list(&clients, &room_list);
        }
    }
}

// ── Command handling ────────────────────────────────────────────────────

fn handle_command(clients: &mut Vec<Client>, cmd: SfuCommand, ice_addrs: &[SocketAddr]) {
    match cmd {
        SfuCommand::AddPeer {
            user_id,
            channel_id,
            signal_tx,
            with_video,
        } => {
            // Prevent duplicate joins
            if clients.iter().any(|c| c.user_id == user_id) {
                drop(signal_tx.send(SignalOut::Error {
                    message: "Already in a voice channel".into(),
                }));
                return;
            }

            // Snapshot existing peers' user_ids + their video state — needed both for
            // build below and for the ParticipantInfo we hand back to the new client.
            let existing_peers: Vec<(Uuid, bool, bool, bool)> = clients
                .iter()
                .filter(|c| c.channel_id == channel_id)
                .map(|c| (c.user_id, c.is_muted, c.is_deafened, c.with_video))
                .collect();

            // Create Rtc instance (ICE lite for server)
            let mut rtc = Rtc::builder()
                .set_ice_lite(true)
                .build(Instant::now());

            // Add all configured ICE candidates (public + LAN)
            for &addr in ice_addrs {
                if let Ok(candidate) = Candidate::host(addr, "udp") {
                    let _ = rtc.add_local_candidate(candidate);
                }
            }

            // dimpl requires handle_timeout before sdp_api().apply() / poll_output()
            drive_time(&mut rtc);

            // Build SDP offer:
            //   - 1x RecvOnly audio (receive client's microphone)
            //   - Optional 1x RecvOnly video (receive client's camera)
            //   - Per existing peer: SendOnly audio (always) + SendOnly video (only if both peers have video)
            let mut change = rtc.sdp_api();
            let recv_audio_mid = change.add_media(
                MediaKind::Audio,
                Direction::RecvOnly,
                None,
                None,
                None,
            );
            let recv_video_mid = if with_video {
                Some(change.add_media(
                    MediaKind::Video,
                    Direction::RecvOnly,
                    None,
                    None,
                    None,
                ))
            } else {
                None
            };

            let mut send_mids: HashMap<Uuid, PeerMids> = HashMap::new();
            for &(other_id, _, _, other_has_video) in &existing_peers {
                let audio_mid = change.add_media(
                    MediaKind::Audio,
                    Direction::SendOnly,
                    None,
                    None,
                    None,
                );
                let video_mid = if with_video && other_has_video {
                    Some(change.add_media(
                        MediaKind::Video,
                        Direction::SendOnly,
                        None,
                        None,
                        None,
                    ))
                } else {
                    None
                };
                send_mids.insert(other_id, PeerMids { audio: audio_mid, video: video_mid });
            }

            match change.apply() { Some((offer, pending)) => {
                // dimpl 0.2.7+ requires handle_timeout after apply()
                drive_time(&mut rtc);

                let offer_sdp = offer.to_sdp_string();

                // Build the Joined event with per-recipient mids: each entry tells the
                // new client which Mid on its OWN Rtc receives that existing peer's media.
                let participants: Vec<ParticipantInfo> = existing_peers
                    .iter()
                    .map(|&(peer_id, is_muted, is_deafened, peer_has_video)| {
                        let peer_mids = &send_mids[&peer_id];
                        ParticipantInfo {
                            user_id: peer_id,
                            is_muted,
                            is_deafened,
                            has_video: peer_has_video,
                            audio_mid: peer_mids.audio.to_string(),
                            video_mid: peer_mids.video.map(|m| m.to_string()),
                        }
                    })
                    .collect();

                // Send Joined event with current participants (with mid mapping)
                drop(signal_tx.send(SignalOut::Joined {
                    room_id: channel_id,
                    participants,
                }));

                // Send the SDP offer
                drop(signal_tx.send(SignalOut::Offer { sdp: offer_sdp }));

                // Add client to the list (dtls_ready=false until answer received)
                clients.push(Client {
                    user_id,
                    channel_id,
                    rtc,
                    signal_tx,
                    with_video,
                    recv_audio_mid: Some(recv_audio_mid),
                    recv_video_mid,
                    send_mids,
                    pending: Some(pending),
                    pending_renegotiations: Vec::new(),
                    dtls_ready: false,
                    is_muted: false,
                    is_deafened: false,
                });

                // Re-negotiate with existing participants to add the new client's media.
                // Each renegotiation also emits a per-recipient ParticipantJoined with mids.
                renegotiate_for_new_peer(clients, channel_id, user_id, with_video);
            } _ => {
                error!("Failed to create SDP offer for {}: apply returned None", user_id);
                drop(signal_tx.send(SignalOut::Error {
                    message: "SDP offer creation failed".into(),
                }));
            }}
        }

        SfuCommand::Answer { user_id, sdp } => {
            // Collect queued renegotiations before borrowing clients mutably
            let mut queued: Vec<Uuid> = Vec::new();
            let mut channel_id_for_renego: Option<Uuid> = None;

            if let Some(client) = clients.iter_mut().find(|c| c.user_id == user_id) {
                match client.pending.take() { Some(pending) => {
                    match SdpAnswer::from_sdp_string(&sdp) {
                        Ok(answer) => {
                            if let Err(e) = client.rtc.sdp_api().accept_answer(pending, answer) {
                                error!("Failed to accept answer from {}: {}", user_id, e);
                            } else {
                                client.dtls_ready = true;
                                drive_time(&mut client.rtc);
                                debug!("Accepted SDP answer from {}", user_id);

                                // Drain queued re-negotiations
                                if !client.pending_renegotiations.is_empty() {
                                    queued = core::mem::take(&mut client.pending_renegotiations);
                                    channel_id_for_renego = Some(client.channel_id);
                                }
                            }
                        }
                        Err(e) => {
                            error!("Invalid SDP answer from {}: {}", user_id, e);
                        }
                    }
                } _ => {
                    warn!("Answer from {} but no pending offer", user_id);
                }}
            }

            // Flush queued re-negotiations now that the pending offer is resolved
            if let Some(ch_id) = channel_id_for_renego {
                for new_peer_id in queued {
                    info!("Flushing queued re-negotiation on {} for peer {}", user_id, new_peer_id);
                    renegotiate_single_client(clients, user_id, new_peer_id, ch_id);
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
/// the new peer's audio (and video if both peers have it). Also emits a
/// per-recipient `ParticipantJoined` with the recipient-specific Mids.
fn renegotiate_for_new_peer(
    clients: &mut [Client],
    channel_id: Uuid,
    new_user_id: Uuid,
    new_peer_with_video: bool,
) {
    for client in clients.iter_mut() {
        if client.channel_id != channel_id || client.user_id == new_user_id {
            continue;
        }
        // Queue if there's already a pending negotiation — will be flushed after answer
        if client.pending.is_some() {
            info!(
                "Queueing re-negotiation for {} (pending offer, will flush after answer)",
                client.user_id
            );
            client.pending_renegotiations.push(new_user_id);
            continue;
        }

        // dimpl requires handle_timeout before sdp_api().apply()
        drive_time(&mut client.rtc);

        // Add a SendOnly track for the new participant's audio (always),
        // plus video if both peers have video enabled.
        let want_video = new_peer_with_video && client.with_video;
        let mut change = client.rtc.sdp_api();
        let audio_mid = change.add_media(
            MediaKind::Audio,
            Direction::SendOnly,
            None,
            None,
            None,
        );
        let video_mid = if want_video {
            Some(change.add_media(
                MediaKind::Video,
                Direction::SendOnly,
                None,
                None,
                None,
            ))
        } else {
            None
        };
        client.send_mids.insert(new_user_id, PeerMids { audio: audio_mid, video: video_mid });

        match change.apply() {
            Some((offer, pending)) => {
                // dimpl 0.2.7+ requires handle_timeout after apply()
                drive_time(&mut client.rtc);

                let offer_sdp = offer.to_sdp_string();
                client.pending = Some(pending);

                // Notify this recipient about the new participant with their specific Mids
                drop(client.signal_tx.send(SignalOut::ParticipantJoined {
                    user_id: new_user_id,
                    has_video: new_peer_with_video,
                    audio_mid: audio_mid.to_string(),
                    video_mid: video_mid.map(|m| m.to_string()),
                }));

                drop(client.signal_tx.send(SignalOut::Offer { sdp: offer_sdp }));
                debug!(
                    "Sent re-negotiation offer to {} for new peer {} (video={})",
                    client.user_id, new_user_id, want_video
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

/// Re-negotiate a single client to add `SendOnly` track(s) for a new peer.
/// Also emits the deferred `ParticipantJoined` event for that target.
fn renegotiate_single_client(clients: &mut [Client], target_user_id: Uuid, new_peer_id: Uuid, _channel_id: Uuid) {
    // Look up the new peer's video state first (immutable borrow)
    let new_peer_with_video = clients
        .iter()
        .find(|c| c.user_id == new_peer_id)
        .map(|c| c.with_video)
        .unwrap_or(false);

    if let Some(client) = clients.iter_mut().find(|c| c.user_id == target_user_id) {
        if client.pending.is_some() {
            // Still pending — re-queue
            warn!("Re-queueing renegotiation for {} (still pending)", target_user_id);
            client.pending_renegotiations.push(new_peer_id);
            return;
        }

        drive_time(&mut client.rtc);

        let want_video = new_peer_with_video && client.with_video;
        let mut change = client.rtc.sdp_api();
        let audio_mid = change.add_media(
            MediaKind::Audio,
            Direction::SendOnly,
            None,
            None,
            None,
        );
        let video_mid = if want_video {
            Some(change.add_media(
                MediaKind::Video,
                Direction::SendOnly,
                None,
                None,
                None,
            ))
        } else {
            None
        };
        client.send_mids.insert(new_peer_id, PeerMids { audio: audio_mid, video: video_mid });

        match change.apply() {
            Some((offer, pending)) => {
                drive_time(&mut client.rtc);
                let offer_sdp = offer.to_sdp_string();
                client.pending = Some(pending);

                drop(client.signal_tx.send(SignalOut::ParticipantJoined {
                    user_id: new_peer_id,
                    has_video: new_peer_with_video,
                    audio_mid: audio_mid.to_string(),
                    video_mid: video_mid.map(|m| m.to_string()),
                }));

                drop(client.signal_tx.send(SignalOut::Offer { sdp: offer_sdp }));
                info!("Sent deferred re-negotiation offer to {} for peer {} (video={})", target_user_id, new_peer_id, want_video);
            }
            None => {
                error!("Deferred re-negotiation failed for {}: apply returned None", target_user_id);
            }
        }
    }
}

/// Broadcast a signaling event to all clients in a room except the sender.
fn broadcast_to_room(clients: &[Client], channel_id: Uuid, exclude: Uuid, event: SignalOut) {
    for client in clients {
        if client.channel_id == channel_id && client.user_id != exclude {
            drop(client.signal_tx.send(event.clone()));
        }
    }
}

/// Sync current room state to the shared `RoomList` for the REST API.
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
