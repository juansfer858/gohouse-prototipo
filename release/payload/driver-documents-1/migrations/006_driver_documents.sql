BEGIN;
CREATE TABLE IF NOT EXISTS driver_document_records (
  driver_id text PRIMARY KEY,
  personal jsonb NOT NULL DEFAULT '{}'::jsonb,
  vehicle jsonb NOT NULL DEFAULT '{}'::jsonb,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS driver_document_files (
  id text PRIMARY KEY,
  driver_id text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  content bytea NOT NULL,
  size_bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_document_files_driver_idx ON driver_document_files(driver_id);
COMMIT;
