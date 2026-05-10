//! Cross-crate primitives: error type, permission bitmask, and strongly-typed identifiers.
/// Errors module.
pub mod errors;
/// Permissions module.
pub mod permissions;
/// Serde helpers shared across crates.
pub mod serde_helpers;
/// Types module.
pub mod types;

pub use errors::JolkrError;
pub use permissions::Permissions;
pub use types::*;
