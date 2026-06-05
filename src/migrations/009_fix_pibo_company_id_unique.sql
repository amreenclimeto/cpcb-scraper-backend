-- Deduplicate rows that share the same company_id (keep latest by id)
DELETE FROM pibo_companies a
USING pibo_companies b
WHERE a.company_id = b.company_id
  AND a.id < b.id;

-- Required for ON CONFLICT (company_id) in savePiboData
CREATE UNIQUE INDEX IF NOT EXISTS idx_pibo_companies_company_id_unique
  ON pibo_companies (company_id);
