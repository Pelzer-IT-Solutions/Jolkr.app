## Jolkr v0.3.0 — Quantum Shield

A major security and polish update. Your DMs are now protected by quantum-proof encryption, voice calls sound better, and the entire UI feels smoother.

### Highlights

- **Quantum-proof encryption** — DM encryption upgraded to a hybrid X25519 + ML-KEM-768 scheme. Your messages are protected against both classical and quantum computing attacks.
- **Voice E2EE** — Voice calls are now end-to-end encrypted with AES-256-GCM frame-level encryption via RTCRtpScriptTransform.
- **Inline video embeds** — YouTube, Vimeo, Twitch, and TikTok links are now embedded directly in chat. Direct video files (mp4, webm) play inline with custom controls.
- **Proper call ringtone** — The old busy-signal beep is replaced by a real ringtone, with a choice between a classic ringtone and a generated tone in Settings.

### New Features
- Inline video embeds with lazy-loading thumbnails and E2EE-compatible client-side URL detection
- Call ringtone selector in Settings > Notifications (Classic / Tone) with preview button
- Syntax highlighting in code blocks via highlight.js
- Image lightbox: click-to-close + scroll zoom (25%-500%)
- Full-window drag & drop file upload with ATTACH_FILES permission check
- Safety numbers for E2EE identity verification in user profiles
- Device management tab in Settings
- Version display + service health link in Settings
- New Jolkr app icon

### Security & Privacy
- Hybrid quantum-proof key exchange (X25519 + ML-KEM-768) for all DM encryption
- Voice call frame encryption (AES-256-GCM via insertable streams)
- Server no longer stores plaintext message content for encrypted DMs
- SVG XSS sanitization on image attachment previews
- Proactive token refresh to prevent random logouts

### Improvements
- Voice calls: fixed bidirectional audio + dual ICE candidates
- WebSocket ping keepalive prevents voice connection drops
- Real-time reaction sync via WebSocket broadcast
- DM presence: contacts show correct online status on login
- Auto-scroll to newest message on channel open
- Desktop context menu (right-click copy/paste) enabled natively on Windows
- Emoji picker themed to match the app's dark palette

### UI/UX Polish
- Skeleton loading states across all components (messages, channels, members, friends)
- Smooth animations on modals, dropdowns, and panel transitions
- Consistent header heights and panel alignment across all columns
- Attachment-only messages no longer have extra spacing
- Pin avatar to top of message row (no jump on reactions)
- Enlarged lightbox preview images (80vw x 60vh minimum)
- Configurable toast duration (5s errors, 3s success)

### Bug Fixes
- Fixed random logouts with longer token lifetime + proactive refresh
- Fixed DM scroll position on channel open
- Fixed Android CORS duplicate header issues via nginx
- Fixed iframe sandbox restrictions breaking video embeds
- Safe error handling in email service, DM broadcast, and dynamic imports

### Downloads
| Platform | File |
|----------|------|
| Windows (installer) | `Jolkr_0.3.0_x64-setup.exe` |
| Windows (MSI) | `Jolkr_0.3.0_x64_en-US.msi` |
| macOS | `Jolkr_0.3.0_aarch64.dmg` |
| Linux (AppImage) | `Jolkr_0.3.0_amd64.AppImage` |
| Linux (deb) | `Jolkr_0.3.0_amd64.deb` |
| Linux (rpm) | `Jolkr_0.3.0-1.x86_64.rpm` |
| Android | `Jolkr_v0.3.0_android.apk` |
| Web | [jolkr.app/app](https://jolkr.app/app/) |
