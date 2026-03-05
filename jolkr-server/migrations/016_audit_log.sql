-- Server audit log for moderation tracking
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    action_type VARCHAR(50) NOT NULL,
    target_id UUID,
    target_type VARCHAR(30),
    changes JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_server ON audit_log(server_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(server_id, action_type);
