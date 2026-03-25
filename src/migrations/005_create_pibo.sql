-- ─── PIBO Companies ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pibo_companies (
  id             SERIAL PRIMARY KEY,
  company_id     INTEGER UNIQUE NOT NULL,
  company        TEXT,
  address        TEXT,
  email          TEXT,
  entity_type    VARCHAR(50)  NOT NULL,  -- 'Brand Owner' | 'Producer' | 'Importer'
  status         VARCHAR(50)  NOT NULL,  -- 'Registered' (fixed for now)
  is_new         BOOLEAN      DEFAULT FALSE,
  first_seen_at  TIMESTAMPTZ  DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ  DEFAULT NOW(),
  synced_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── PIBO Status History ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pibo_status_history (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER     NOT NULL,
  entity_type  VARCHAR(50),
  old_status   VARCHAR(50),
  new_status   VARCHAR(50) NOT NULL,
  changed_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PIBO Baseline Tracker ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pibo_baseline (
  id              SERIAL PRIMARY KEY,
  entity_type     VARCHAR(50) UNIQUE NOT NULL,
  baseline_count  INTEGER     NOT NULL,
  set_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pibo_entity_type  ON pibo_companies(entity_type);
CREATE INDEX IF NOT EXISTS idx_pibo_status       ON pibo_companies(status);
CREATE INDEX IF NOT EXISTS idx_pibo_is_new       ON pibo_companies(is_new);
CREATE INDEX IF NOT EXISTS idx_pibo_history_cid  ON pibo_status_history(company_id);