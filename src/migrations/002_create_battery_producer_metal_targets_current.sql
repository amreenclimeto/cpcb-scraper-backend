CREATE TABLE IF NOT EXISTS battery_producer_metal_targets_current (
  user_id          BIGINT,
  metal_type       TEXT,
  epr_target       NUMERIC,
  credits_received NUMERIC,
  last_scraped_at  TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, metal_type),
  FOREIGN KEY (user_id) REFERENCES battery_producers_metal(user_id)
);
