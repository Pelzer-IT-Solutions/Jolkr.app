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

---

## F02 — narrow channel-scoped event broadcasts to permitted recipients

**Files changed:**
- `jolkr-server/crates/jolkr-api/src/ws/gateway.rs` (new `broadcast_to_channel_visible` + private `compute_allowed_user_ids`)
- `jolkr-server/crates/jolkr-api/src/nats_bus.rs` (`spawn_subscriber` now takes `PgPool`; server-arm branches on event variant)
- `jolkr-server/crates/jolkr-api/src/main.rs` (passes `pool.clone()` into `spawn_subscriber`)

**Why:** `ChannelCreate` / `ChannelUpdate` / `ChannelDelete` / `ChannelPermissionUpdate` were `publish_to_server` → server-wide fan-out, leaking the channel name/topic/permissions to every member regardless of `VIEW_CHANNELS`. Now the NATS subscriber branches on those four variants and calls the new helper which batch-resolves perms via `compute_channel_permissions_for_all_members` and only delivers to allowed sessions. Helper falls back to `broadcast_to_server` on DB lookup failure (safe — affected events carry only IDs after channel delete). Event payloads unchanged; only the recipient set narrows.

**Risk if rolled back:** Private channel metadata leak returns.

---

## F04 — login lockout keyed on `(email, ip_subnet)`

**Files changed:**
- `jolkr-server/crates/jolkr-api/src/routes/auth.rs` (new `ip_subnet_key` helper, `check`/`record`/`clear_login_lockout` take subnet, `login` uses `resolve_client_ip` from F19)

**Why:** Lockout keyed on email alone was a one-line targeted DoS — anyone knowing the address could trip the counter from any IP. Bucketing by `/24` (v4) / `/64` (v6) instead pins an attacker to a reasonable scope without locking out an entire NAT for one user. The "notify by email when N subnets hit one address in window W" side of the audit is left as a TODO comment in code pending user decision before adding outbound mail.

**Risk if rolled back:** Targeted account-lockout DoS returns.

---

## F09 — per-target prekey-bundle quota

**Files changed:**
- `jolkr-server/crates/jolkr-api/src/routes/keys.rs` (new `check_prekey_fetch_quota`, both bundle GET handlers call it)

**Why:** Each prekey fetch consumes one of the target's one-time prekeys. With no per-target rate limit, an authenticated requester could drain a victim's pool. Redis key `prekey_fetch:{requester}:{target}` capped at 5/day per pair; over-cap returns HTTP 429 via the `RateLimited` variant introduced in F15.

**Risk if rolled back:** Per-target prekey pool can be drained.

---

## F10 — CSP `connect-src` no longer accepts arbitrary HTTPS

**Files changed:**
- `jolkr-app/src-tauri/tauri.conf.json` (replace `https:` with explicit `https://jolkr.app https://*.jolkr.app`)

**Why:** The bare `https:` glob in `connect-src` let post-XSS code exfiltrate to any HTTPS origin. Verified by grepping `jolkr-app/src` for outbound fetch/XHR/WS targets — the FE proxies all third-party content through `/api/*`, so the explicit jolkr.app pair is sufficient. Embed providers (YouTube, Vimeo, etc.) load into iframes governed by `frame-src` and are unaffected.

**Risk if rolled back:** Unrestricted HTTPS exfiltration channel returns.

---

## F14 — typed `OverwriteTarget` enum in the permission resolver

**Files changed:**
- `jolkr-server/crates/jolkr-common/src/types.rs` (new `OverwriteTarget` enum + `as_str`/`from_text`)
- `jolkr-server/crates/jolkr-db/src/repo/roles.rs` (`apply_overwrites` parses `target_type` via `from_text`)

**Why:** `apply_overwrites` compared `o.target_type == "role"` / `"member"` directly. A typo or case-drifted row (`"Role"`, `"ROLE"`) silently failed to match and the overwrite was dropped — a privilege escalation in either direction. The resolver now parses via `OverwriteTarget::from_text`; unknown values yield `None` and the overwrite is skipped explicitly (loud).

Scoped per audit guidance: DB column stays TEXT (no schema change), no `CHECK` constraint, the migration of `channel_overwrites.rs` + ~10 callers to take `OverwriteTarget` instead of `&str` exceeds the 5-file gate and is deferred.

**Risk if rolled back:** Case drift / typos in `target_type` silently drop overwrites.

---

## F22 — PII in `#[tracing::instrument]` spans (audit list, no fix yet)

**Files inspected:** all `jolkr-server/crates/*/src/**/*.rs`. No code change in this commit — the audit asked to "produce a list and ASK before changing more than a handful."

**Findings (high-confidence PII captured by tracing spans):**

| File | Function | PII captured |
|------|----------|--------------|
| `jolkr-core/src/services/auth.rs` | `register(_, _, email, username, _)` | `email`, `username` |
| `jolkr-core/src/services/auth.rs` | `login(_, _, email, _)` | `email` |
| `jolkr-core/src/services/auth.rs` | `reset_password(_, email, _)` | `email` |
| `jolkr-core/src/services/auth.rs` | `request_password_reset(_, email)` | `email` |

Spans skip `password`, `jwt_secret`, `new_password`, `current_password`, `token` correctly. `email` / `username` are scalar `&str` args and are captured by default. A one-line `skip(...)` extension on each of these four `#[tracing::instrument]` attributes removes the leak. **No code change yet — awaiting user decision on whether to land all four in one sweep or pick a subset.**

`jolkr-core/src/services/user.rs` was inspected separately — `update_me`/`update_profile`/`search_users` already `skip(req)` / `skip(query)`, so user-supplied PII inside those structs/queries isn't logged.

**Risk:** None until acted on. Listing here so the fix doesn't get lost.




