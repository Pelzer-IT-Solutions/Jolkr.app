-- Server discovery: public servers
ALTER TABLE servers ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_servers_public ON servers (is_public) WHERE is_public = true;
