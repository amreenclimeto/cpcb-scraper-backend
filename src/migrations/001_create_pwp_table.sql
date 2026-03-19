-- PWP companies table
CREATE TABLE IF NOT EXISTS pwp_companies (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(50) UNIQUE NOT NULL,
  company TEXT,
  state TEXT,
  category TEXT,
  class TEXT,
  address TEXT,
  status VARCHAR(50),
  is_new BOOLEAN DEFAULT false,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- PWP baseline table (entity_type nahi hai kyunki PWP mein ek hi type hai)
CREATE TABLE IF NOT EXISTS pwp_baseline (
  id SERIAL PRIMARY KEY,
  baseline_count INTEGER NOT NULL,
  set_at TIMESTAMPTZ DEFAULT NOW()
);

-- PWP status history
CREATE TABLE IF NOT EXISTS pwp_status_history (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(50),
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  changed_at TIMESTAMPTZ DEFAULT NOW()
);