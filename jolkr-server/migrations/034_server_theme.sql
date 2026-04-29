-- Add theme column to servers for storing server-wide theme settings (JSONB)
ALTER TABLE servers ADD COLUMN theme JSONB;
