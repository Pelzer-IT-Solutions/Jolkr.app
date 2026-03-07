## Jolkr v0.1.0 — Private Chat, No Jokes

The first public release of Jolkr, a privacy-first chat platform built as a real alternative to Discord. Your conversations stay yours — end-to-end encrypted by default.

### Highlights

- **End-to-end encrypted DMs** — All direct messages are encrypted with X25519 + AES-256-GCM. Keys are derived deterministically from your password, so encryption works seamlessly across all your devices.
- **Voice channels** — Real-time voice chat powered by a custom WebRTC SFU media server. Join a channel and talk — no calls to start.
- **1-on-1 voice calls** — Call friends directly from any DM conversation.
- **Cross-platform** — Available as a desktop app (Windows, macOS, Linux) and a web app. Android APK included.

### Communication
- Servers with text and voice channels
- Channel categories for organization
- Threads on any message
- Group DMs (multi-person private chats)
- Message replies, editing, and deletion
- File attachments with image preview and lightbox
- Markdown formatting with a toolbar (bold, italic, code, quotes)
- @mentions with autocomplete
- Emoji reactions with Apple-style rendering
- Inline `:shortcode:` emoji autocomplete
- Custom server emojis
- Link embeds with Open Graph previews
- Polls
- Message pinning
- Message search with advanced filters (from, has, before, after)

### Server Management
- Role system with granular permission bitflags
- Channel permission overwrites per role
- Channel categories (create, edit, reorder)
- Server invites with expiry and max-use options
- Server moderation: kick, ban, timeout, nicknames
- Audit log for all moderation actions
- Webhooks per channel
- NSFW channel warnings with age-gate
- Slowmode per channel

### Privacy & Security
- End-to-end encrypted DMs (X25519 key exchange, AES-256-GCM)
- Deterministic key derivation — same keys on every device, no key sync needed
- No message content stored in plaintext on the server for encrypted conversations
- Secure token storage via Stronghold (desktop)

### Desktop App
- Built with Tauri 2.0 — lightweight, native performance
- System tray with minimize-to-tray
- Auto-start on boot
- Deep link support (`jolkr://` protocol)
- Built-in auto-updater
- Desktop notifications with sounds
- Browser shortcuts disabled (no accidental Ctrl+R refreshes)

### Downloads
| Platform | File |
|----------|------|
| Windows (installer) | `Jolkr_0.1.0_x64-setup.exe` |
| Windows (MSI) | `Jolkr_0.1.0_x64_en-US.msi` |
| macOS | `Jolkr_0.1.0_aarch64.dmg` |
| Linux (AppImage) | `Jolkr_0.1.0_amd64.AppImage` |
| Linux (deb) | `Jolkr_0.1.0_amd64.deb` |
| Linux (rpm) | `Jolkr_0.1.0-1.x86_64.rpm` |
| Android | `app-universal-release.apk` |
| Web | [jolkr.app/app](https://jolkr.app/app/) |
