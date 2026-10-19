CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, created_at);
CREATE TABLE IF NOT EXISTS admin_usernames (user_id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE);
ALTER TABLE eblast_campaigns ADD COLUMN tracking_name TEXT;
