CREATE TABLE IF NOT EXISTS deeplake_records (
  collection text NOT NULL,
  id text NOT NULL,
  project_id text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id),
  CHECK (data->>'id' = id)
);
CREATE INDEX IF NOT EXISTS deeplake_records_project ON deeplake_records (project_id, collection, created_at, id);
CREATE INDEX IF NOT EXISTS deeplake_records_data ON deeplake_records USING gin (data jsonb_path_ops);
CREATE TABLE IF NOT EXISTS deeplake_jobs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cycle','ingest','replay','maintenance','publish')),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 100),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, idempotency_key),
  CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS deeplake_jobs_ready ON deeplake_jobs (available_at, created_at, id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS deeplake_jobs_project ON deeplake_jobs (project_id, created_at, id);
CREATE TABLE IF NOT EXISTS deeplake_budget_runs (
  project_id text NOT NULL,
  run_id text NOT NULL,
  limit_usd numeric(24,12) NOT NULL CHECK (limit_usd >= 0),
  PRIMARY KEY (project_id, run_id)
);
CREATE TABLE IF NOT EXISTS deeplake_budget_reservations (
  reservation_key text PRIMARY KEY,
  project_id text NOT NULL,
  run_id text NOT NULL,
  reserved_usd numeric(24,12) NOT NULL CHECK (reserved_usd >= 0),
  actual_usd numeric(24,12) CHECK (actual_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  FOREIGN KEY (project_id, run_id) REFERENCES deeplake_budget_runs (project_id, run_id)
);
CREATE INDEX IF NOT EXISTS deeplake_budget_run ON deeplake_budget_reservations (project_id, run_id);
