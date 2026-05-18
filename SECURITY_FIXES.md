# Security Audit 2026-05-18 — Fix Log

Branch: `security/audit-2026-05`. One finding = one commit. Each entry below is reverted in isolation with `git revert <sha>` unless a "Depends on" line is present.

Source spec: see audit doc handed off via session (also tracked locally as `security-audit.md`, untracked).

Progress is tracked in [.claude/plans/audit-2026-05-18-security-fixes.md](.claude/plans/audit-2026-05-18-security-fixes.md). This file records what landed.

---

<!-- Entries appended below as findings are completed -->

## F19 — extract `client_ip` helper to shared module

**Files changed:**
- new `jolkr-server/crates/jolkr-api/src/middleware/client_ip.rs` (helper + 7 unit tests)
- `jolkr-server/crates/jolkr-api/src/middleware/mod.rs` (register submodule)
- `jolkr-server/crates/jolkr-api/src/middleware/rate_limit.rs` (drop local copies)
- `jolkr-server/crates/jolkr-api/src/ws/handler.rs` (drop local copies)

**Why:** `is_trusted_proxy` + the XFF-walking IP-resolution logic was duplicated across `rate_limit.rs` and `ws/handler.rs`. Drift between the two would silently break either rate-limiting or WS limits. Required as a prereq for F04 (lockout key now needs the client IP). One shared `middleware::client_ip` module is the single source of truth, with unit-test coverage for the proxy-trust + rightmost-non-trusted-XFF logic.

**Risk if rolled back:** Two copies of IP-resolution logic come back; subsequent F04 lockout-by-(email,ip) fix would also need to be reverted.

**Commit:** see `git log --grep "security(F19)"`.

---

## F03 — equalize login timing with precomputed dummy hash

**Files changed:**
- `jolkr-server/crates/jolkr-core/src/services/auth.rs` (add `DUMMY_PASSWORD_HASH`, rewrite `login`, two unit tests)

**Why:** `login()` returned immediately on unknown email but ran Argon2 on known emails — the ~100 ms gap leaked which emails were registered. Now `login()` always calls `verify_password` against either the real hash or a precomputed dummy Argon2 hash, so both paths cost the same. Dummy hash is built once at startup via `LazyLock`.

**Risk if rolled back:** Email enumeration via login timing returns.

---

## F05 — `/api/auth/logout` verifies session ownership

**Files changed:**
- `jolkr-server/crates/jolkr-api/src/routes/auth.rs` (one-line guard in `logout`)

**Why:** `logout` accepted any refresh token in the body and deleted whatever session matched its hash, with no check that the session belonged to the authenticated caller. Holding a leaked refresh token (shared computer, log scrape, etc.) was enough to revoke another user. Now returns `Forbidden` when `session.user_id != auth.user_id`, before the delete.

**Risk if rolled back:** Anyone with a stolen refresh token can revoke that user's session.

---

## F08 — `MessageService::edit_message` rechecks channel access

**Files changed:**
- `jolkr-server/crates/jolkr-core/src/services/message.rs` (post-author auth check)

**Why:** Only `msg.author_id == caller_id` was checked. A user kicked/banned from the server still held a valid JWT until expiry and could PATCH their old messages — which then broadcast as `MessageUpdate`. Now after the author check we also resolve the channel's server, bypass for the server owner, and otherwise require membership + `VIEW_CHANNELS` (mirrors the non-author branch of `delete_message`). DM messages flow through `DmService::edit_message` instead, so are out of scope for this commit — flagged as follow-up.

**Risk if rolled back:** Kicked/banned member can edit old messages, broadcasting `MessageUpdate` events into the server.

---

## F17 — voice WS pins JWT algorithm to HS256

**Files changed:**
- `jolkr-server/crates/jolkr-media/src/signaling.rs` (`validate_jwt`)

**Why:** `Validation::default()` can be permissive about which algorithms it accepts. The API server already pins to `HS256` + `validate_exp = true` (`AuthService::validate_token`); the voice service must match so a token forged with a different algorithm cannot slip past voice auth.

**Risk if rolled back:** Voice WS may accept JWTs validated by an unexpected algorithm.

---

## F18 — soft-delete filter verification: not applicable

**Files changed:** _(no code change)_

**Why:** Audit asked to verify that `MessageRepo::get_by_id` filters out soft-deleted messages. After grep, there is no `deleted_at` or `is_deleted` column anywhere in `jolkr-server` — `MessageRepo::delete` performs a hard `DELETE FROM messages WHERE id = $1`. The audit's preconditions don't hold; nothing to filter. No commit produced for this finding.

**Risk if rolled back:** N/A.

---

## F11 — Redis blacklist check fails CLOSED on Redis errors

**Files changed:**
- `jolkr-server/crates/jolkr-api/src/middleware/auth.rs` (enum-ify `AuthError`, fail-closed)
- `jolkr-server/crates/jolkr-api/src/ws/handler.rs` (Identify-branch fail-closed)

**Why:** Both paths used `unwrap_or(false)` on the blacklist EXISTS check, so a Redis outage silently treated revoked tokens as valid. Now both log `tracing::error!` and refuse: HTTP returns 503 via a new `AuthError::ServiceUnavailable` variant; WS sends `GatewayEvent::Error("Auth backend unavailable")` and skips identification (chose this over closing the socket — same UX as the existing auth-failure path; both are defensible).

**Risk if rolled back:** Revoked access tokens become valid again during Redis outages.

---

## F12 phase 1 — reduce JWT access-token TTL from 24 h to 1 h

**Files changed:**
- `jolkr-server/crates/jolkr-core/src/services/auth.rs` (`issue_tokens` exp + `expires_in`)

**Why:** A leaked `JWT_SECRET` previously gave a 24-hour forging window. 1 h tightens that 24×. Refresh tokens (30 d, hash-bound in `sessions`) handle silent renewal; the FE refresh flow is unchanged. **Phase 2** (Ed25519 / RS256) is deferred per audit instruction.

**Risk if rolled back:** Wider blast radius on JWT-secret leakage.

---

## F13 — `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` required at startup

**Files changed:**
- `jolkr-server/crates/jolkr-api/src/config.rs`

**Why:** Both vars previously fell back to dev defaults (`"jolkr"`/`"jolkr_dev_secret"`) — production deploys that forgot to set them ran with publicly-known credentials. Now both are `env::var(...).expect(...)` with a 16-char minimum on the secret (same pattern as `JWT_SECRET`). The prod `docker-compose` already enforces `MINIO_ROOT_USER:?` / `MINIO_ROOT_PASSWORD:?` so the `.env.example` doc flow is unchanged.

**Risk if rolled back:** Silent dev-creds in production deployments.

---

## F15 — per-user rate limit for `/api/auth/resend-verification`

**Files changed:**
- `jolkr-server/crates/jolkr-common/src/errors.rs` (new `RateLimited(String)` variant)
- `jolkr-server/crates/jolkr-api/src/errors.rs` (map to `TOO_MANY_REQUESTS`)
- `jolkr-server/crates/jolkr-api/src/routes/auth.rs` (`check_verify_resend_quota`)

**Why:** No per-user limit meant a user could flood themselves with verification email and burn outbound SMTP quota. Now a Redis-backed `verify_resend:{user_id}` quota refuses with HTTP 429 over 3/hour. The `RateLimited` variant also unblocks F09's prekey quota.

**Risk if rolled back:** Per-user resend amplification returns.

---

## F16 — defense-in-depth `MessageService::get_message_by_id_for`

**Files changed:**
- `jolkr-server/crates/jolkr-core/src/services/message.rs` (new authenticated variant; old fn → `pub(crate)`)
- `jolkr-server/crates/jolkr-api/src/routes/messages.rs` (embed-task migration)
- `jolkr-server/crates/jolkr-api/src/routes/attachments.rs` (broadcast migration)
- `jolkr-server/crates/jolkr-api/src/routes/polls.rs` (`create_poll` migration)

**Why:** `get_message_by_id` had no auth — safe today only because every existing caller had already validated permission. Any future caller would be one mistake away from a leak. Added an authenticated variant that requires server membership + `VIEW_CHANNELS` (mirrors F08), restricted the unchecked variant to `pub(crate)`, migrated all three external callers.

**Risk if rolled back:** Defense-in-depth removed; future callers can leak messages cross-channel.

---

## F20 — document why DOMPurify keeps `style` allowed

**Files changed:**
- `jolkr-app/src/components/MessageContent.tsx` (WHY-comment above `ALLOWED_ATTR`)

**Why:** The markdown renderer emits inline `style=` on `<img>` (max-width/max-height caps for inline GIFs and custom emojis) and on the GIF embed wrapper. Style values are literal constants in renderer source — never user input — so re-allowing `style` at sanitization time is safe. Comment ensures a future refactor doesn't drop it without seeing what would break.

**Risk if rolled back:** Comment lost, future maintainer may inadvertently drop `style` and break inline rendering.



