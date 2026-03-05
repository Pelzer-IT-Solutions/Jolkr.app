-- Message link embeds (URL previews)
CREATE TABLE IF NOT EXISTS message_embeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    image_url TEXT,
    site_name TEXT,
    color VARCHAR(7),              -- hex color e.g. #FF5733
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_embeds_message ON message_embeds(message_id);

-- DM message embeds
CREATE TABLE IF NOT EXISTS dm_message_embeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_message_id UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    image_url TEXT,
    site_name TEXT,
    color VARCHAR(7),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dm_message_embeds_message ON dm_message_embeds(dm_message_id);
