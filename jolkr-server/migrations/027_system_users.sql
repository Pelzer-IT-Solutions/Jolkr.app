ALTER TABLE users ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET is_system = true WHERE email = 'team@jolkr.app';
