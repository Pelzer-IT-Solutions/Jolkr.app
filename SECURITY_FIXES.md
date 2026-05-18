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


