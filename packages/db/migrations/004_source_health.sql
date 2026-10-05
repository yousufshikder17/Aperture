BEGIN;
CREATE TABLE IF NOT EXISTS source_health (
  source_id text PRIMARY KEY, status text NOT NULL DEFAULT 'unvalidated',
  last_checked_at timestamptz, last_successful_at timestamptz,
  records_received integer NOT NULL DEFAULT 0, duration_ms integer NOT NULL DEFAULT 0,
  diagnostics jsonb NOT NULL DEFAULT '[]'
);
COMMIT;
