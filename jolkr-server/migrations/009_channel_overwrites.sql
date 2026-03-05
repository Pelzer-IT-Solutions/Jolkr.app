-- Channel permission overwrites (Discord-style allow/deny per role or member)
CREATE TABLE channel_permission_overwrites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('role', 'member')),
    target_id   UUID NOT NULL,  -- role.id or member.id (polymorphic, no FK)
    allow       BIGINT NOT NULL DEFAULT 0,
    deny        BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel_id, target_type, target_id)
);

CREATE INDEX idx_channel_overwrites_channel ON channel_permission_overwrites(channel_id);
