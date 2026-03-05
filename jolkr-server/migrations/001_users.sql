-- 001_users.sql: Users, Devices, Sessions
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ──────────────────────────────────────────────────────────────

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT NOT NULL UNIQUE,
    username        TEXT NOT NULL UNIQUE,
    display_name    TEXT,
    avatar_url      TEXT,
    password_hash   TEXT NOT NULL,
    status          TEXT,
    bio             TEXT,
    is_online       BOOLEAN NOT NULL DEFAULT false,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email    ON users (email);
CREATE INDEX idx_users_username ON users (username);

-- ── Devices ────────────────────────────────────────────────────────────

CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name     TEXT NOT NULL,
    device_type     TEXT NOT NULL,           -- e.g. "android", "ios", "desktop", "web"
    push_token      TEXT,
    last_active_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_user ON devices (user_id);

-- ── Sessions (refresh tokens) ──────────────────────────────────────────

CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id           UUID REFERENCES devices(id) ON DELETE SET NULL,
    refresh_token_hash  TEXT NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user  ON sessions (user_id);
CREATE INDEX idx_sessions_token ON sessions (refresh_token_hash);
