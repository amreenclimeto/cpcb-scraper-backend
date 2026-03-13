-- Current Snapshot Table
CREATE TABLE IF NOT EXISTS plasticwastemanagement (
  reg_id VARCHAR PRIMARY KEY,
  application_id VARCHAR,
  company_legal_name TEXT,
  company_trade_name TEXT,
  applicant_type VARCHAR,
  status VARCHAR,
  created_on TIMESTAMP,
  first_seen_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP,
  synced_at TIMESTAMP
);

-- Status History Table
CREATE TABLE IF NOT EXISTS plastic_status_history (
  id SERIAL PRIMARY KEY,
  reg_id VARCHAR,
  old_status VARCHAR,
  new_status VARCHAR,
  changed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_plastic_status_history_regid
ON plastic_status_history(reg_id);