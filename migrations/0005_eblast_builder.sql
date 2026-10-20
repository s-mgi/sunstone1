ALTER TABLE eblast_campaigns ADD COLUMN settings TEXT;
ALTER TABLE eblast_campaigns ADD COLUMN exported_at TEXT;
CREATE TABLE IF NOT EXISTS eblast_images (key TEXT PRIMARY KEY, campaign_id INTEGER, width INTEGER, height INTEGER, bytes INTEGER, content_type TEXT, uploaded_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), data BLOB);
CREATE INDEX IF NOT EXISTS idx_eblast_images_campaign ON eblast_images(campaign_id);
