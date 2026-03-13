CREATE TABLE IF NOT EXISTS battery_producers_metal (
  user_id     BIGINT PRIMARY KEY,
  legal_name  TEXT,
  trade_name  TEXT,
  state       TEXT,
  email       TEXT,
  address     TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);