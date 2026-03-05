-- Custom server emojis
CREATE TABLE IF NOT EXISTS server_emojis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(32) NOT NULL,
    image_key TEXT NOT NULL,          -- S3 object key (not presigned URL)
    uploader_id UUID NOT NULL REFERENCES users(id),
    animated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (server_id, name)
);

CREATE INDEX idx_server_emojis_server ON server_emojis(server_id);
