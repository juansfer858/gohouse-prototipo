BEGIN;
CREATE TABLE IF NOT EXISTS media_assets (
  id text PRIMARY KEY,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  bytes bytea NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_assets_created_at_idx ON media_assets(created_at DESC);
REVOKE ALL ON media_assets FROM PUBLIC;
COMMIT;
