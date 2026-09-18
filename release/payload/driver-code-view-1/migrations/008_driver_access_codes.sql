BEGIN;
CREATE TABLE IF NOT EXISTS driver_access_codes (
  driver_id text PRIMARY KEY,
  pin_plain text NOT NULL CHECK (pin_plain ~ '^[0-9]{4}$'),
  registered_by text NOT NULL DEFAULT '',
  registered_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON driver_access_codes FROM PUBLIC;
COMMIT;
