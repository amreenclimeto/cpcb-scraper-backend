-- =====================================================
-- Current Snapshot Table
-- =====================================================
CREATE TABLE IF NOT EXISTS plasticwastemanagement (
  reg_id                VARCHAR PRIMARY KEY,
  application_id        VARCHAR,
  company_legal_name    TEXT,
  company_trade_name    TEXT,
  applicant_type        VARCHAR,
  status                VARCHAR,
  created_on            TIMESTAMP,
  first_seen_at         TIMESTAMP DEFAULT NOW(),
  last_seen_at          TIMESTAMP,
  synced_at             TIMESTAMP,
  is_new_after_baseline BOOLEAN NOT NULL DEFAULT FALSE   -- 🆕 baseline ke baad aaya?
);

-- Fast query for new+approved records
CREATE INDEX IF NOT EXISTS idx_pwm_new_baseline_status
  ON plasticwastemanagement (is_new_after_baseline, status);

-- =====================================================
-- Status History Table
-- =====================================================
CREATE TABLE IF NOT EXISTS plastic_status_history (
  id         SERIAL PRIMARY KEY,
  reg_id     VARCHAR,
  old_status VARCHAR,
  new_status VARCHAR,
  changed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plastic_status_history_regid
  ON plastic_status_history (reg_id);

-- =====================================================
-- Sync Cursors Table  🆕
-- Baseline count + other cursors store karne ke liye
-- =====================================================
CREATE TABLE IF NOT EXISTS sync_cursors (
  cursor_key        TEXT PRIMARY KEY,
  last_seen_at      TIMESTAMPTZ,
  last_total_count  INTEGER DEFAULT 0
);

-- Baseline cursor — pehli scrape ka count yahan lock hoga
INSERT INTO sync_cursors (cursor_key, last_seen_at, last_total_count)
VALUES ('epr_national_baseline', NOW(), 0)
ON CONFLICT (cursor_key) DO NOTHING;

-- New companies cursor
INSERT INTO sync_cursors (cursor_key, last_seen_at, last_total_count)
VALUES ('epr_national_new_companies', NOW(), 0)
ON CONFLICT (cursor_key) DO NOTHING;