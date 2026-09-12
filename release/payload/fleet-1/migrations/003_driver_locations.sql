CREATE TABLE IF NOT EXISTS driver_location_events (
  id BIGSERIAL PRIMARY KEY,
  driver_id TEXT NOT NULL,
  order_id TEXT,
  event_type TEXT NOT NULL,
  order_state TEXT,
  gps_status TEXT NOT NULL DEFAULT 'ok',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_location_events_driver_time
  ON driver_location_events(driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_location_events_order_time
  ON driver_location_events(order_id, recorded_at DESC)
  WHERE order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS driver_last_location (
  driver_id TEXT PRIMARY KEY,
  order_id TEXT,
  order_state TEXT,
  gps_status TEXT NOT NULL DEFAULT 'ok',
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_last_location_recorded
  ON driver_last_location(recorded_at DESC);
