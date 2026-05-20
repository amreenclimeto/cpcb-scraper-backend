-- Add state column to pibo_companies (populated from address via scraper)
ALTER TABLE pibo_companies
ADD COLUMN IF NOT EXISTS state TEXT;

CREATE INDEX IF NOT EXISTS idx_pibo_state ON pibo_companies(state);
