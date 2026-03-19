-- Add index on member_roles(member_id) to speed up batch role lookups
CREATE INDEX IF NOT EXISTS idx_member_roles_member_id ON member_roles(member_id);
