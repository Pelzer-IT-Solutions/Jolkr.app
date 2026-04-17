-- 037_gif_favorites.sql: Per-user GIF favorites
-- =========================================================================

CREATE TABLE IF NOT EXISTS gif_favorites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gif_id      VARCHAR(64) NOT NULL,
    gif_url     TEXT NOT NULL,
    preview_url TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, gif_id)
);

CREATE INDEX idx_gif_favorites_user ON gif_favorites(user_id, added_at DESC);
