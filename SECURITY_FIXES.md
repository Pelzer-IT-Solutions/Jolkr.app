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

