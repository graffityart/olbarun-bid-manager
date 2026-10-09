CREATE TABLE IF NOT EXISTS bid_states (id text PRIMARY KEY, data text NOT NULL);
CREATE TABLE IF NOT EXISTS bid_logs (id text PRIMARY KEY, data text NOT NULL, created timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS bid_logs_created_idx ON bid_logs (created DESC);
