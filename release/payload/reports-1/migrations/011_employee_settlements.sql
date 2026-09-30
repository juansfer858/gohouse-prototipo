BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS llanos_employee_settlements (
  id uuid PRIMARY KEY,
  request_key uuid NOT NULL UNIQUE,
  employee_id text NOT NULL,
  employee_name text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL CHECK (date_to >= date_from),
  preview_hash text NOT NULL,
  service_count integer NOT NULL CHECK (service_count > 0),
  total_fare numeric(18,2) NOT NULL CHECK (total_fare >= 0),
  company_amount numeric(18,2) NOT NULL CHECK (company_amount >= 0),
  employee_amount numeric(18,2) NOT NULL CHECK (employee_amount >= 0),
  payment_method text NOT NULL,
  payment_reference text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS llanos_employee_settlement_items (
  order_id text PRIMARY KEY,
  settlement_id uuid NOT NULL REFERENCES llanos_employee_settlements(id),
  snapshot jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS llanos_settlement_employee_date_idx
  ON llanos_employee_settlements(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llanos_settlement_items_batch_idx
  ON llanos_employee_settlement_items(settlement_id);
REVOKE ALL ON llanos_employee_settlements, llanos_employee_settlement_items FROM PUBLIC;
COMMIT;
