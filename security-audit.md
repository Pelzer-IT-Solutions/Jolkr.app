# Security audit follow-up — Jolkr.app

## Your role
You are an experienced senior developer with a security-engineering mindset. You know what you're doing. When uncertain about a fix, you:
1. First search the codebase for prior art (look for similar patterns already in use here).
2. Then check the relevant library's docs/source for the idiomatic solution.
3. If both turn up nothing solid, you ASK ME a directed, narrow question — do not guess, do not invent APIs, do not silently pick a plausible-looking option.

You write code that matches the existing style of this repo: Rust with `unsafe_code = "forbid"`, sqlx parameterized queries, axum extractors, services in `jolkr-core`, repos in `jolkr-db`, routes in `jolkr-api`.

## Reversibility — REQUIRED before touching anything
1. Verify the working tree is clean (`git status`). If not, stop and tell me.
2. Create a branch: `git checkout -b security/audit-2026-05`.
3. Create `SECURITY_FIXES.md` at repo root. For each finding you complete, append: heading `## F## — short name`, "Files changed", "Why", "Risk if rolled back", and the commit SHA.
4. One finding = one commit. Commit message format: `security(F##): short imperative summary`. Never combine findings.
5. Do not rewrite history. No squash, no rebase, no force-push. If you need to fix an earlier commit, add a follow-up commit.
6. Every fix must be revertable in isolation with `git revert <sha>`. If a finding's fix depends on an earlier finding's fix, say so in `SECURITY_FIXES.md` under "Depends on".
7. Do NOT touch DB migrations or change any public API response shape without asking me first.

## Per-finding workflow
1. Read every file listed for the finding before writing any code.
2. Grep for cross-references (who calls this function? who reads this field?).
3. State your plan in 2–4 bullets in chat, then apply it.
4. Add or extend at least one test where feasible (`jolkr-server/tests/` or a `#[cfg(test)]` module).
5. Run `cargo check -p <affected crate>` and `cargo clippy -p <affected crate> -- -D warnings` before committing.
6. Commit. Append to `SECURITY_FIXES.md`. Move on.

## Gates — ASK before proceeding if any are true
- The fix would touch more than 5 files.
- The fix changes any HTTP response status code or JSON shape.
- The fix changes any WebSocket event payload.
- The fix touches `migrations/` or alters any DB schema.
- You cannot locate a symbol or file referenced below — DO NOT assume it was renamed; ask.
- A finding has a "decision required" note — answer it with me before writing code.

## Out of scope unless I say otherwise
- `jolkr-server/crates/jolkr-core/src/crypto/keys.rs` (appears unused; confirm before changing).
- Frontend logic changes beyond what is listed.
- Performance refactors.
- Dependency upgrades.

---

# Findings — fix in this order

## CRITICAL

### F01 — Voice/Video SFU performs no channel-level authorization
**Files:** `jolkr-server/crates/jolkr-media/src/signaling.rs`, `jolkr-server/crates/jolkr-media/src/sfu/mod.rs` (`SfuCommand::AddPeer` branch ~line 384), `jolkr-server/crates/jolkr-api/src/routes/dms/calls.rs`, `jolkr-server/crates/jolkr-api/src/routes/channels.rs`.

**Problem:** `VoiceClientEvent::Join { channel_id }` is forwarded straight into `SfuCommand::AddPeer`. The SFU only checks "is this user already in a voice channel?" — never that the user is a server member with VIEW_CHANNELS/CONNECT on that channel, nor that they are a DM participant. Any authenticated user with a known channel UUID can join.

**Fix (short-lived voice token):**
1. Add an API endpoint `POST /api/voice/token` that takes `{ channel_id: Uuid }`, validates membership + CONNECT permission (server channel) or DM membership, and returns `{ token: String }`. The token is a JWT with claims `{ sub: user_id, channel_id, exp: now + 30s, kind: "voice" }`, signed with the existing `JWT_SECRET`.
2. Change `VoiceClientEvent::Join` to require a `voice_token` field instead of (or alongside) the current shape. Decision required: should this be a new field or a new event variant `JoinV2`? **ASK ME** before choosing.
3. In `signaling.rs`, verify the voice token: signature, `exp`, `kind == "voice"`, `sub == identified user_id`, and `channel_id` matches the requested join. Reject otherwise.
4. The frontend will need a one-line change to call `/api/voice/token` before WS Join. Leave a `TODO(F01-frontend)` comment in the relevant TS file (`jolkr-app/src/...`) and tell me where so I can wire it.

**Test:** an authenticated user without membership cannot join; an authenticated user with a stale (>30s) token cannot join; a token for channel A cannot be used to join channel B.

---

### F02 — Private channel metadata leaks to non-members via server-wide broadcasts
**Files:** `jolkr-server/crates/jolkr-api/src/routes/channels.rs`, `jolkr-server/crates/jolkr-api/src/nats_bus.rs` (around the dispatcher that calls `gateway.broadcast_to_server`), `jolkr-server/crates/jolkr-db/src/repo/roles.rs` (helper `compute_channel_permissions_for_all_members` already exists).

**Problem:** `ChannelCreate`, `ChannelUpdate`, `ChannelDelete`, and `ChannelPermissionUpdate` are published via `publish_to_server` and fanned out to every member, leaking channel name/topic/permissions to users who lack VIEW_CHANNELS on that channel.

**Fix:**
1. In the NATS subscriber that currently calls `gateway.broadcast_to_server(server_id, event)`, branch on the event type. For the four channel-scoped events above, compute permissions and dispatch only to permitted users.
2. Add a helper `gateway.broadcast_to_channel_visible(server_id, channel_id, &event, &pool)` that uses `compute_channel_permissions_for_all_members` to get the set of `member_id` → perms, then iterates over its `clients` map to find sessions for those users and `try_send`.
3. Do NOT change the event payload — only the recipient set narrows.

**Test:** create a private channel with @everyone denied VIEW_CHANNELS and one role allowed. A WS session for a non-member of that role must not receive the `ChannelCreate` event. A WS session for an allowed member must.

---

## HIGH

### F03 — Login timing leak enables user enumeration
**Files:** `jolkr-server/crates/jolkr-core/src/services/auth.rs` (`login`, `verify_password`).

**Problem:** `AuthService::login` returns immediately on unknown email; on known email it runs Argon2. The timing difference (~100ms) reveals whether an email is registered.

**Fix:** when `UserRepo::get_by_email` fails, still call `Argon2::default().verify_password(...)` against a precomputed dummy hash to equalize cost. Use a `LazyLock<String>` for the dummy hash so it's computed once at startup. Make sure both paths return the same `JolkrError::Unauthorized`.

**Test:** measure timing for 100 attempts each on existing and non-existing emails; the means should be within one σ. A simple `#[ignore]`-gated test that asserts the means are within 30% of each other is enough.

---

### F04 — Account lockout enables targeted DoS
**Files:** `jolkr-server/crates/jolkr-api/src/routes/auth.rs` (`check_login_lockout`, `record_failed_login`).

**Problem:** Lockout keyed on `email` alone. Anyone who knows a victim's email can lock them out from any IP.

**Fix:** key lockout on the tuple `(email_lower, client_ip_subnet)`. Use a `/24` for IPv4 and `/64` for IPv6. Reuse `resolve_client_ip` from `ws/handler.rs` — pull it into a shared module (e.g. `middleware/client_ip.rs`) and consume from both places. Keep the per-email counter ONLY for a sliding "notify the user by email" trigger (optional, can be a TODO comment).

**Decision required:** should we also send a "suspicious login activity" email when N IPs hit one email within W minutes? **ASK ME** before adding email sending.

---

### F05 — `/api/auth/logout` doesn't verify session ownership
**Files:** `jolkr-server/crates/jolkr-api/src/routes/auth.rs` (`logout`).

**Problem:** The handler accepts a `refresh_token` from the body and deletes whatever session matches its hash, with no check that `session.user_id == auth.user_id`. A user holding someone else's refresh token can revoke their session.

**Fix:** after `SessionRepo::get_by_token`, return `JolkrError::Forbidden` if `session.user_id != auth.user_id`. Do this BEFORE the delete. One commit, one-line guard, plus a test.

---

### F06 — Kicked/banned user keeps receiving channel events via stale subscriptions
**Files:** `jolkr-server/crates/jolkr-api/src/ws/gateway.rs` (`revoke_server_for_user`).

**Problem:** The comment claims "channels will be checked on next subscribe anyway" — but existing channel subscriptions are never cleared. After kick/ban, the user's open WS continues receiving `MessageCreate` and other channel events.

**Fix:** in `revoke_server_for_user`, also remove `subscribed_channels` entries that belong to the revoked server. The `ConnectedClient` currently doesn't track `channel → server`. Add a `HashMap<Uuid, Uuid>` field `channel_servers` populated on `subscribe()` (look up `ChannelRepo::get_by_id` once and cache the `server_id`). Then on revoke, drop any channel whose stored server matches the revoked one.

**Decision required:** the existing `subscribe()` is sync. To look up `channel → server` you'll need an async variant OR push the lookup to the caller (the WS Subscribe handler in `handler.rs`). Either works; the second is less invasive. **ASK ME** which you prefer if it's not obvious from reading both.

---

### F07 — Voice signaling WebSocket lacks the controls the chat WS has
**Files:** `jolkr-server/crates/jolkr-media/src/signaling.rs`.

**Problem:** Compared to `jolkr-api/src/ws/handler.rs`, the voice WS has no per-IP connection cap, no per-connection message rate limit, no heartbeat timeout, and no Redis blacklist check on Identify. Result: revoked JWTs still work for voice; logout doesn't kick voice users.

**Fix:** port from `ws/handler.rs`:
- `MAX_WS_PER_IP = 10` with the same `LazyLock<DashMap<IpAddr, AtomicU32>>` pattern and inc/dec on connect/disconnect.
- Token bucket: 30/s with burst 30, identical algorithm.
- `tokio::time::timeout(Duration::from_secs(90), ws_receiver.next())` around the recv loop.
- After `validate_jwt`, look up `blacklist:{jti}` in Redis. To do that, the voice service needs a Redis handle in `VoiceState`. Add it from wherever the API server gets its `RedisStore` from in `main.rs`.

**Test:** revoked JWT cannot Identify; >10 connections from one IP fail.

---

### F08 — Kicked/banned user can edit their own historical messages
**Files:** `jolkr-server/crates/jolkr-core/src/services/message.rs` (`edit_message`).

**Problem:** Only `msg.author_id == caller_id` is checked. A user banned from the server still holds a valid JWT until expiry and can PATCH old messages, which then broadcast as `MessageUpdate`.

**Fix:** after the authorship check, look up the channel:
- If it's a server channel: verify the caller is still a member AND has VIEW_CHANNELS on this channel (mirror what `delete_message` already does for the non-author path).
- If it's a DM: verify `DmRepo::is_member(pool, channel_id, caller_id)`.
Return `JolkrError::Forbidden` otherwise.

**Test:** kicked member cannot edit their own message in the server; non-member cannot edit anything; happy path still works.

---

## MEDIUM

### F09 — Prekey-bundle DoS (one-time prekey exhaustion)
**Files:** `jolkr-server/crates/jolkr-api/src/routes/keys.rs` (`get_prekey_bundle`, `get_prekey_bundle_by_user`).

**Problem:** Each call consumes a one-time prekey. Authenticated, no per-target rate limit — an attacker can drain a victim's pool.

**Fix:** add a Redis-backed quota: `prekey_fetch:{requester_user_id}:{target_user_id}` with INCR + EXPIRE = 86400. Cap at 5 fetches per target per day per requester. Return `429 Too Many Requests` over the cap. Reuse the rate-limit Redis helpers from `middleware/rate_limit.rs` rather than rolling new ones.

---

### F10 — CSP `connect-src` is overly permissive
**Files:** `jolkr-app/src-tauri/tauri.conf.json` (`app.security.csp`).

**Problem:** `connect-src 'self' https: wss://jolkr.app wss://*.jolkr.app` — the bare `https:` allows fetch to any HTTPS origin. Post-XSS exfiltration is unrestricted.

**Fix:** replace `https:` with the explicit list of providers actually used. Grep the frontend for `fetch(` and `new URL(` calls to external hosts to compile the list. Likely includes the GIPHY API host, GIF CDN hosts, YouTube/Vimeo/etc. embed metadata hosts. If the list ends up being long enough that maintenance becomes a problem, tell me — we'll move it to a CSP-from-config approach.

**Decision required:** is there a config or constant in the frontend listing allowed embed providers? Search for it first; if found, use that as the source of truth. **ASK ME** if you find more than two competing lists.

---

### F11 — Redis fail-open on access-token revocation
**Files:** `jolkr-server/crates/jolkr-api/src/middleware/auth.rs` (line ~64), `jolkr-server/crates/jolkr-api/src/ws/handler.rs` (Identify branch — same pattern), `jolkr-server/crates/jolkr-media/src/signaling.rs` (after F07 is applied).

**Problem:** `conn.exists(&blacklist_key).await.unwrap_or(false)` — when Redis fails, revoked tokens are treated as valid.

**Fix:** change to fail-closed. On Redis error, log a `tracing::error!` and return `AuthError("Auth backend unavailable")` mapped to HTTP 503. Apply the same change in all three locations so behavior is consistent.

**Decision required:** the chat WS Identify currently sends a `GatewayEvent::Error` and continues. Should it instead close the socket on Redis failure? **ASK ME** — both are defensible.

---

### F12 — JWT lifetime + symmetric secret (defense-in-depth)
**Files:** `jolkr-server/crates/jolkr-core/src/services/auth.rs` (`issue_tokens`), `jolkr-server/crates/jolkr-api/src/config.rs`.

**Problem:** 24h access tokens with HS256. A leaked `JWT_SECRET` allows forging any user's token for up to 24h, and HS256 means the same secret signs and verifies.

**Fix (phase 1 only — phase 2 needs my OK):**
- Phase 1: reduce access-token TTL to 60 minutes. Change the hardcoded `24` and `expires_in: 86400` to `60` and `3600`. Verify the frontend refresh flow handles this — it should, since refresh tokens have a 30-day TTL.
- Phase 2 (DO NOT DO without my explicit OK): migrate to Ed25519 / RS256. **ASK ME** first.

---

### F13 — `MINIO_SECRET_KEY` has a silent dev default
**Files:** `jolkr-server/crates/jolkr-api/src/config.rs`.

**Problem:** Unlike `JWT_SECRET` (fails loud at startup), `MINIO_SECRET_KEY` falls back to `"jolkr_dev_secret"`. Production deploys that forget to set it run with a known credential.

**Fix:** require it from env with the same `expect(...)` pattern used for `JWT_SECRET`. Add the same min-length check (16 chars is enough for an S3 secret). Same treatment for `MINIO_ACCESS_KEY` if it has a dev default. Update any `.env.example` / docker-compose / docs you find.

---

### F14 — `target_type` matched as magic string in permission resolver
**Files:** `jolkr-server/crates/jolkr-db/src/repo/roles.rs` (`apply_overwrites`), `jolkr-server/crates/jolkr-db/src/repo/channel_overwrites.rs`.

**Problem:** `o.target_type == "role"` / `"member"` — typos or case drift silently drop overwrites, which is a privilege escalation.

**Fix:** introduce `pub enum OverwriteTarget { Role, Member }` in `jolkr-common`, derive `sqlx::Type` over a SQL enum or `TEXT` with check. Replace the string compares. Keep wire compatibility — the DB column stays `TEXT` for now. Do NOT add a migration to add a CHECK constraint without asking me.

**Decision required:** keep the column as `TEXT` (with Rust-side validation only) or also add `CHECK (target_type IN ('role','member'))`? Schema change requires my OK — **ASK ME**.

---

## LOW / INFORMATIONAL

### F15 — `request_email_verification` resend has no rate limit
**Files:** `jolkr-server/crates/jolkr-api/src/routes/auth.rs` (`resend_verification`), `jolkr-server/crates/jolkr-api/src/routes/mod.rs` (router setup).

**Fix:** add a per-user limit via Redis: `verify_resend:{user_id}` capped at 3 per hour. Return 429 over the cap.

---

### F16 — Service-layer `get_message_by_id` has no authz
**Files:** `jolkr-server/crates/jolkr-core/src/services/message.rs` (`get_message_by_id`).

**Problem:** Safe today only because routes do the check. Defense in depth: any future caller (background job, new endpoint) is one mistake away from a leak.

**Fix:** add an authenticated variant `get_message_by_id_for(pool, message_id, caller_id)` that runs the channel-access check and is the preferred API. Keep the unchecked version `pub(crate)` only, with a doc comment that it must not be exposed via routes.

---

### F17 — Voice WS `validate_jwt` uses `Validation::default()`
**Files:** `jolkr-server/crates/jolkr-media/src/signaling.rs` (`validate_jwt`).

**Fix:** pin the algorithm: `let mut v = Validation::new(jsonwebtoken::Algorithm::HS256); v.validate_exp = true;`. Match what the API server does in `AuthService::validate_token`.

---

### F18 — `MessageRepo::get_by_id` soft-delete handling
**Files:** `jolkr-server/crates/jolkr-db/src/repo/messages.rs`.

**Verify:** does the SELECT filter `deleted_at IS NULL`? If not, callers can edit/react to deleted messages. Add the filter and a test.

---

### F19 — `is_trusted_proxy` duplicated across modules
**Files:** `jolkr-server/crates/jolkr-api/src/middleware/rate_limit.rs`, `jolkr-server/crates/jolkr-api/src/ws/handler.rs`.

**Fix:** extract into `jolkr-api/src/middleware/client_ip.rs` (or `common.rs`) along with `resolve_client_ip`. Re-export. Replace the duplicates. This is a prereq for F04; do it before F04 if you tackle F04 first.

---

### F20 — DOMPurify `style` attribute allowed
**Files:** `jolkr-app/src/components/MessageContent.tsx` (`ALLOWED_ATTR`).

**Verify:** is `style` actually used anywhere in the markdown→HTML pipeline? Search for emitted `style=` in the highlight/embed code. If unused, remove it from `ALLOWED_ATTR`. If used, document why with a one-line comment and leave it.

---

### F21 — Password policy uses composition rules (NIST SP 800-63B advises against)
**Files:** `jolkr-server/crates/jolkr-core/src/services/auth.rs` (`validate_password`).

**Decision required:** keep composition rules or switch to length-only (min 12) + HaveIBeenPwned k-anonymity check? Both are defensible. **ASK ME** before changing.

---

### F22 — PII in tracing spans (`#[tracing::instrument]`)
**Files:** various `services/*.rs` and route handlers.

**Verify:** which spans capture `email`, `username`, `display_name`? Add `#[tracing::instrument(skip(email))]` etc. where the field is sensitive. Don't drop logging entirely — just `skip` the PII args. This is a sweep, not a fix; produce a list and ASK ME before changing more than a handful.

---

# When you're done
- Push the branch: `git push -u origin security/audit-2026-05`.
- Tell me: which findings completed, which deferred (and why), which need my decision.
- Do not open a PR yet — I will review the branch first.