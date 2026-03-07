# Plan: Code Audit + UI/UX Audit + Health Status

## Datum: 2026-03-06

---

## Plan 1: Full Code Audit (Backend + Frontend)

### Status: DONE

1. [x] Attachment enrichment O(n*m) → HashMap — `enrich_with_attachments()` helper in message.rs
2. [x] Push notification permission filtering — filter recipients with `compute_channel_permissions()` + error logging
3. [x] DM message index — migration 020_dm_message_index.sql
4. [x] Bounded channel for WS client queues — `mpsc::channel(256)` + `try_send()` backpressure
5. [x] Heartbeat timeout — 90s timeout via `tokio::time::timeout` on receive loop
6. [x] Fire-and-forget logging — error logging on embed processing + push notification tasks
7. [x] Dead code — `broadcast_all` kept (used in nats_bus.rs), `connected_count` removed
8. [ ] Extract `check_permission_or_owner()` helper — skipped (low impact, cross-file refactor)
9. [x] MessageTile React.memo() — wrapped with `memo()`

---

## Plan 2: Full UI/UX Audit

### Status: DONE

1. [x] Message list virtualization — @tanstack/react-virtual, dynamic item heights
2. [x] Lazy-load emoji-picker-react — React.lazy() + Suspense in MessageTile + MessageInput
3. [x] Page transition animations — CSS `.page-transition` on Channel + DmChat content areas
4. [x] Skeleton loading states — CSS `.skeleton` pulse animation class
5. [ ] Scroll position restoration — skipped (virtualizer handles scroll state internally)
6. [x] Hover transitions — global `transition: background-color 0.15s ease` on all buttons/links
7. [x] Toast/notification animations — `toast-enter` / `toast-exit` keyframes
8. [x] Image loading — `.avatar-placeholder` + `img[loading="lazy"]` opacity transition

---

## Plan 3: Health Status — Relay

### Status: DONE

1. [x] API: HTTP check naar media server — `check_relay()` with reqwest + 5s timeout
2. [x] Naam: "Relay" — 5e service in health response
3. [ ] Media server health uitbreiden — skipped (basic /health is sufficient)
4. [x] Health response updated — JSON + HTML + degraded logic (relay down = degraded)
5. [x] Config: MEDIA_SERVER_URL env var — default `http://jolkr-media:8081`
