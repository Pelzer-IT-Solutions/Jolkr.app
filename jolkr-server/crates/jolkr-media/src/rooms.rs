//! Shared room state for the REST API.
//!
//! The SFU thread periodically syncs room info into this structure
//! so that HTTP handlers can list active voice rooms.

use serde::Serialize;
use std::sync::{Arc, RwLock};
use uuid::Uuid;

/// Info about an active voice room.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct RoomInfo {
    pub channel_id: Uuid,
    pub participant_count: usize,
    pub participant_ids: Vec<Uuid>,
}

/// Thread-safe list of active voice rooms.
#[derive(Clone, Default)]
pub(crate) struct RoomList {
    inner: Arc<RwLock<Vec<RoomInfo>>>,
}

impl RoomList {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Replace the entire room list (called by the SFU thread).
    pub(crate) fn update(&self, rooms: Vec<RoomInfo>) {
        if let Ok(mut guard) = self.inner.write() {
            *guard = rooms;
        }
    }

    /// Get a snapshot of all active rooms.
    pub(crate) fn list(&self) -> Vec<RoomInfo> {
        self.inner.read().map(|g| g.clone()).unwrap_or_default()
    }
}
