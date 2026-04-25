//! Domain services: cryptography helpers, business logic, and use-cases on top of the database layer.
#![expect(
    tail_expr_drop_order,
    reason = "Edition-2024 drop-order audit: temporaries here hold awaited futures whose destructors only release pooled handles. No observable side effects from drop reorder. Will be revisited during the 2024 edition migration."
)]
/// Crypto module.
pub mod crypto;
/// Services module.
pub mod services;

pub use services::auth::{AuthService, Claims, TokenPair};
pub use services::category::CategoryService;
pub use services::channel::ChannelService;
pub use services::channel_encryption::ChannelEncryptionService;
pub use services::dm::DmService;
pub use services::emoji::EmojiService;
pub use services::friendship::FriendshipService;
pub use services::invite::InviteService;
pub use services::key::KeyService;
pub use services::message::MessageService;
pub use services::role::RoleService;
pub use services::server::ServerService;
pub use services::thread::ThreadService;
pub use services::user::UserService;
