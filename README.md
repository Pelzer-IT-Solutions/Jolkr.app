# Jolkr

Privacy-first chat platform with end-to-end encryption, voice channels, and cross-platform support.

## Features

- **End-to-End Encryption** — X25519 key exchange + AES-256-GCM message encryption
- **Voice & Video** — WebRTC-based voice channels powered by a custom SFU media server
- **Cross-Platform** — Web, Windows, macOS, Linux, Android, iOS (via Tauri 2.0)
- **Real-Time** — WebSocket messaging with NATS event bus
- **Servers & Channels** — Discord-style servers with categories, roles, permissions, and threads
- **Direct Messages** — 1-on-1 and group DMs with E2EE support
- **Rich Features** — Reactions, polls, webhooks, custom emojis, message search, file sharing

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, TailwindCSS, Zustand |
| Desktop/Mobile | Tauri 2.0 |
| Backend | Rust (Axum) |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Storage | MinIO (S3-compatible) |
| Events | NATS |
| Media | Custom WebRTC SFU (str0m) |
| Infrastructure | Docker Compose, Nginx |

## Links

- **Web App**: [jolkr.app/app](https://jolkr.app/app)
- **Status**: [jolkr.app/health](https://jolkr.app/health)

## License

This project is **not open-source**. All rights reserved by [Pelzer IT Solutions](https://pelzer-it.nl).
The source code is publicly available for transparency only. See [LICENSE](LICENSE) for details.
