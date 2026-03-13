CREATE TABLE IF NOT EXISTS battery_producer_metal_targets_history (
  id               SERIAL PRIMARY KEY,
  user_id          BIGINT,
  metal_type       TEXT,
  old_target       NUMERIC,
  new_target       NUMERIC,
  target_diff      NUMERIC,
  old_credits      NUMERIC,
  new_credits      NUMERIC,
  credits_diff     NUMERIC,
  changed_at       TIMESTAMP DEFAULT NOW()
);