-- 🔹 Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 🔹 Table 1: epr_pwp_cer_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS epr_pwp_cer_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 🔹 Table 2: epr_pwp_cer_snapshot_details
-- ============================================================
CREATE TABLE IF NOT EXISTS epr_pwp_cer_snapshot_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES epr_pwp_cer_snapshots(id) ON DELETE CASCADE,

  category TEXT NOT NULL,

  generated BIGINT NOT NULL DEFAULT 0,
  transferred BIGINT NOT NULL DEFAULT 0,
  available BIGINT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 🔹 Indexes
CREATE INDEX IF NOT EXISTS idx_pwp_snapshot_details_snapshot_id
ON epr_pwp_cer_snapshot_details(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_pwp_snapshot_details_category
ON epr_pwp_cer_snapshot_details(category);

-- ============================================================
-- 🔹 Table 3: epr_pwp_cer_deltas
-- ============================================================
CREATE TABLE IF NOT EXISTS epr_pwp_cer_deltas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES epr_pwp_cer_snapshots(id) ON DELETE CASCADE,

  category TEXT NOT NULL,

  generated_diff BIGINT DEFAULT 0,
  transferred_diff BIGINT DEFAULT 0,
  available_diff BIGINT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 🔹 Indexes
CREATE INDEX IF NOT EXISTS idx_pwp_deltas_snapshot_id
ON epr_pwp_cer_deltas(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_pwp_deltas_category
ON epr_pwp_cer_deltas(category);

-- ============================================================
-- 🔥 Unique Constraints (important)
-- ============================================================
ALTER TABLE epr_pwp_cer_snapshot_details
ADD CONSTRAINT unique_pwp_snapshot_category
UNIQUE (snapshot_id, category);

ALTER TABLE epr_pwp_cer_deltas
ADD CONSTRAINT unique_pwp_delta_snapshot_category
UNIQUE (snapshot_id, category);