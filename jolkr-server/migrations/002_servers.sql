-- 002_servers.sql: Servers, Categories, Channels, Members, Roles, Invites
-- =========================================================================

-- ── Servers ────────────────────────────────────────────────────────────

CREATE TABLE servers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    description     TEXT,
    icon_url        TEXT,
    banner_url      TEXT,
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_servers_owner ON servers (owner_id);

-- ── Categories ─────────────────────────────────────────────────────────

CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    position        INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_server ON categories (server_id);

-- ── Channels ───────────────────────────────────────────────────────────

CREATE TABLE channels (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id           UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    name                TEXT NOT NULL,
    topic               TEXT,
    kind                TEXT NOT NULL DEFAULT 'text',   -- text, voice, announcement, category
    position            INT NOT NULL DEFAULT 0,
    is_nsfw             BOOLEAN NOT NULL DEFAULT false,
    slowmode_seconds    INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channels_server   ON channels (server_id);
CREATE INDEX idx_channels_category ON channels (category_id);

-- ── Members ────────────────────────────────────────────────────────────

CREATE TABLE members (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname    TEXT,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (server_id, user_id)
);

CREATE INDEX idx_members_server ON members (server_id);
CREATE INDEX idx_members_user   ON members (user_id);

-- ── Roles ──────────────────────────────────────────────────────────────

CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       INT NOT NULL DEFAULT 0,
    position    INT NOT NULL DEFAULT 0,
    permissions BIGINT NOT NULL DEFAULT 0,
    is_default  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_roles_server ON roles (server_id);

-- ── Member ↔ Role join table ───────────────────────────────────────────

CREATE TABLE member_roles (
    member_id   UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (member_id, role_id)
);

-- ── Invites ────────────────────────────────────────────────────────────

CREATE TABLE invites (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    max_uses    INT,
    use_count   INT NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_invites_code ON invites (code);
CREATE INDEX idx_invites_server      ON invites (server_id);
