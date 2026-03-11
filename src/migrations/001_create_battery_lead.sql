-- 001_create_battery_lead.sql
CREATE TABLE IF NOT EXISTS battery_producers (
  user_id BIGINT,
  metal TEXT,
  legal_name TEXT,
  trade_name TEXT,
  state TEXT,
  email TEXT,
  address TEXT,
  epr_targets NUMERIC,
  credits_received NUMERIC,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY(user_id, metal)
);