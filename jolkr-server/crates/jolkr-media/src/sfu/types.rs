use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Commands sent from WebSocket handlers to the SFU thread.
pub(crate) enum SfuCommand {
    /// A new peer wants to join a voice channel.
    AddPeer {
        user_id: Uuid,
        channel_id: Uuid,
        signal_tx: tokio::sync::mpsc::UnboundedSender<SignalOut>,
    },
    /// Peer sent an SDP answer to a server-initiated offer.
    Answer {
        user_id: Uuid,
        sdp: String,
    },
    /// Peer sent an ICE candidate.
    IceCandidate {
        user_id: Uuid,
        candidate: String,
    },
    /// Peer wants to leave the voice channel.
    Leave {
        user_id: Uuid,
    },
    /// Peer mute state changed.
    Mute {
        user_id: Uuid,
        muted: bool,
    },
    /// Peer deafen state changed.
    Deafen {
        user_id: Uuid,
        deafened: bool,
    },
}

/// Signaling messages sent from the SFU thread to a peer's WebSocket.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "op", content = "d")]
pub(crate) enum SignalOut {
    /// Confirmation that the peer joined the room, with current participants.
    Joined {
        room_id: Uuid,
        participants: Vec<ParticipantInfo>,
    },
    /// Server-initiated SDP offer (client must respond with Answer).
    Offer {
        sdp: String,
    },
    /// A new participant joined the voice channel.
    ParticipantJoined {
        user_id: Uuid,
    },
    /// A participant left the voice channel.
    ParticipantLeft {
        user_id: Uuid,
    },
    /// A participant's mute state changed.
    MuteUpdate {
        user_id: Uuid,
        muted: bool,
    },
    /// A participant's deafen state changed.
    DeafenUpdate {
        user_id: Uuid,
        deafened: bool,
    },
    /// A participant started or stopped speaking (voice activity).
    #[expect(
        dead_code,
        reason = "Reserved for upcoming voice-activity detection wiring."
    )]
    Speaking {
        /// User identifier whose voice activity changed.
        user_id: Uuid,
        /// Whether the user is currently speaking.
        speaking: bool,
    },
    /// An error occurred.
    Error {
        message: String,
    },
}

/// Public info about a participant in a voice room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ParticipantInfo {
    pub user_id: Uuid,
    pub is_muted: bool,
    pub is_deafened: bool,
}
