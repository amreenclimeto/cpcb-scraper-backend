-- add_is_active_to_pwp_companies.sql

ALTER TABLE pwp_companies
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

UPDATE pwp_companies
SET is_active = true
WHERE is_active IS NULL;

ALTER TABLE pwp_companies
ALTER COLUMN is_active SET NOT NULL;