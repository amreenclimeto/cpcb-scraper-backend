CREATE TABLE IF NOT EXISTS pwp_companies (
  company_id    INTEGER PRIMARY KEY,
  company       TEXT,
  state         TEXT,
  category      TEXT,
  class         TEXT,
  address       TEXT,
  status        VARCHAR(50),
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW(),
  synced_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pwp_status_history (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL,
  old_status  VARCHAR(50),
  new_status  VARCHAR(50),
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwp_first_seen
ON pwp_companies(first_seen_at);

CREATE INDEX IF NOT EXISTS idx_pwp_status_history_company
ON pwp_status_history(company_id);

INSERT INTO sync_cursors (cursor_key, last_seen_at, last_total_count)
VALUES ('pwp_new_companies', NOW(), 0)
ON CONFLICT (cursor_key) DO NOTHING;