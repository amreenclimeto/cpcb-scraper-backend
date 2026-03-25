import pool from "../config/db.config.js";

// ─── Save scraped data to DB ──────────────────────────────────────────────────
export const savePiboData = async (rows, entityType, status) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ─── Pehli scrape hai ya nahi check karo ──────────────────────────────
    const baselineResult = await client.query(
      `SELECT baseline_count FROM pibo_baseline WHERE entity_type = $1`,
      [entityType],
    );
    const isFirstScrape = baselineResult.rows.length === 0;

    // ─── Existing records load karo (sirf is entity ke) ───────────────────
    const existing = await client.query(
      `SELECT company_id, status FROM pibo_companies WHERE entity_type = $1`,
      [entityType],
    );

    const existingMap = new Map();
    existing.rows.forEach((r) =>
      existingMap.set(Number(r.company_id), r.status),
    );

    let newCompanies = 0;
    let statusChanges = 0;

    for (const item of rows) {
      const id = Number(item.company_id);
      const oldStatus = existingMap.get(id);
      const isNew = !existingMap.has(id);

      if (isNew) {
        // Pehli scrape → is_new = FALSE (ye baseline hai)
        // Agli scrapes → is_new = TRUE (genuinely naya record)
        const flagNew = !isFirstScrape;
        if (flagNew) newCompanies++;

        await client.query(
          `INSERT INTO pibo_companies
            (company_id, company, address, email, entity_type, status,
             is_new, first_seen_at, last_seen_at, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
           ON CONFLICT (company_id) DO NOTHING`,
          [
            id,
            item.company,
            item.address,
            item.email !== "***" ? item.email : null,
            entityType,
            status,
            flagNew,
          ],
        );

        await client.query(
          `INSERT INTO pibo_status_history
            (company_id, entity_type, old_status, new_status)
           VALUES ($1, $2, NULL, $3)`,
          [id, entityType, status],
        );
      } else if (oldStatus !== status) {
        // ─── Status change ────────────────────────────────────────────────
        statusChanges++;

        await client.query(
          `INSERT INTO pibo_status_history
            (company_id, entity_type, old_status, new_status)
           VALUES ($1, $2, $3, $4)`,
          [id, entityType, oldStatus, status],
        );

        await client.query(
          `UPDATE pibo_companies
           SET status = $2, last_seen_at = NOW(), synced_at = NOW()
           WHERE company_id = $1 AND entity_type = $3`,
          [id, status, entityType],
        );
      } else {
        // ─── No change — sirf timestamp update ───────────────────────────
        await client.query(
          `UPDATE pibo_companies
           SET last_seen_at = NOW(), synced_at = NOW()
           WHERE company_id = $1 AND entity_type = $2`,
          [id, entityType],
        );
      }
    }

    // ─── Pehli scrape mein baseline set karo ──────────────────────────────
    if (isFirstScrape) {
      await client.query(
        `INSERT INTO pibo_baseline (entity_type, baseline_count, set_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (entity_type)
         DO UPDATE SET baseline_count = $2, set_at = NOW()`,
        [entityType, rows.length],
      );
      console.log(`📌 Baseline set for ${entityType}: ${rows.length}`);
    }

    await client.query("COMMIT");

    return { total: rows.length, newCompanies, statusChanges, isFirstScrape };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── Get stats for all 3 entities ────────────────────────────────────────────
export const getPiboStats = async () => {
  const result = await pool.query(`
    SELECT
      entity_type,
      COUNT(*)                                  AS total,
      COUNT(*) FILTER (WHERE is_new = TRUE)     AS new_count
    FROM pibo_companies
    WHERE status = 'Registered'
    GROUP BY entity_type
  `);

  const stats = {
    brandOwner: { total: 0, newCount: 0 },
    producer: { total: 0, newCount: 0 },
    importer: { total: 0, newCount: 0 },
  };

  const keyMap = {
    "Brand Owner": "brandOwner",
    Producer: "producer",
    Importer: "importer",
  };

  result.rows.forEach((row) => {
    const key = keyMap[row.entity_type];
    if (key) {
      stats[key] = {
        total: Number(row.total),
        newCount: Number(row.new_count),
      };
    }
  });

  return stats;
};

// ─── Get records with filters ─────────────────────────────────────────────────
export const getPiboRecords = async ({
  entity_type,
  is_new,
  page = 1,
  limit = 50,
  date,
  from_date,
  to_date,
  search,
}) => {
  const conditions = [`status = 'Registered'`];
  const values = [];
  let idx = 1;

  if (entity_type) {
    conditions.push(`entity_type = $${idx++}`);
    values.push(entity_type);
  }

  if (is_new !== undefined) {
    conditions.push(`is_new = $${idx++}`);
    values.push(is_new === "true" || is_new === true);
  }

  if (search && search.trim()) {
    // ✅ Don't strip special chars — use a single phrase match instead
    const trimmed = search.trim();

    conditions.push(`(
    company ILIKE $${idx}
    OR address ILIKE $${idx}
    OR entity_type ILIKE $${idx}
  )`);
    values.push(`%${trimmed}%`);
    idx++;
  }

  // ✅ Date filters
  if (date) {
    conditions.push(`DATE(first_seen_at) = $${idx++}`);
    values.push(date);
  } else if (from_date && to_date) {
    conditions.push(`DATE(first_seen_at) BETWEEN $${idx++} AND $${idx++}`);
    values.push(from_date, to_date);
  }

  const offset = (Number(page) - 1) * Number(limit);
  const where = conditions.join(" AND ");

  const filterValues = [...values]; // snapshot for COUNT query

  const [countResult, dataResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FROM pibo_companies WHERE ${where}`,
      filterValues, // ✅ only filter params
    ),
    pool.query(
      `SELECT company_id, company, address, entity_type,
            status, is_new, first_seen_at, synced_at
     FROM pibo_companies
     WHERE ${where}
     ORDER BY first_seen_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
      [...filterValues, Number(limit), offset], // ✅ correct indices
    ),
  ]);
  return {
    total: Number(countResult.rows[0].count),
    page: Number(page),
    limit: Number(limit),
    records: dataResult.rows,
  };
};

// ─── Mark records as seen (is_new = FALSE) ────────────────────────────────────
export const markPiboAsSeen = async ({ entity_type, company_ids }) => {
  // Option 1: Specific company_ids
  if (company_ids && Array.isArray(company_ids) && company_ids.length > 0) {
    const result = await pool.query(
      `UPDATE pibo_companies
       SET is_new = FALSE, synced_at = NOW()
       WHERE company_id = ANY($1::int[])`,
      [company_ids],
    );
    return { updated: result.rowCount };
  }

  // Option 2: Ek entity ke sab new records
  if (entity_type) {
    const result = await pool.query(
      `UPDATE pibo_companies
       SET is_new = FALSE, synced_at = NOW()
       WHERE entity_type = $1 AND is_new = TRUE`,
      [entity_type],
    );
    return { updated: result.rowCount };
  }

  // Option 3: Sab entities ke sab new records
  const result = await pool.query(
    `UPDATE pibo_companies
     SET is_new = FALSE, synced_at = NOW()
     WHERE is_new = TRUE`,
  );
  return { updated: result.rowCount };
};

export const exportPiboRecords = async ({
  entity_type,
  is_new,
  date,
  from_date,
  to_date,
  search,
}) => {
  const conditions = [`status = 'Registered'`];
  const values = [];
  let idx = 1;

  if (entity_type) {
    conditions.push(`entity_type = $${idx++}`);
    values.push(entity_type);
  }

  if (is_new !== undefined) {
    conditions.push(`is_new = $${idx++}`);
    values.push(is_new === "true" || is_new === true);
  }

  // ✅ Fixed search — same as getPiboRecords
  if (search && search.trim()) {
    const trimmed = search.trim();
    conditions.push(`(
      company ILIKE $${idx}
      OR address ILIKE $${idx}
      OR entity_type ILIKE $${idx}
    )`);
    values.push(`%${trimmed}%`);
    idx++;
  }

  if (date) {
    conditions.push(`DATE(first_seen_at) = $${idx++}`);
    values.push(date);
  } else if (from_date && to_date) {
    conditions.push(`DATE(first_seen_at) BETWEEN $${idx++} AND $${idx++}`);
    values.push(from_date, to_date);
  }

  const where = conditions.join(" AND ");

  const result = await pool.query(
    `SELECT company_id, company, address, entity_type,
            status, is_new, first_seen_at
     FROM pibo_companies
     WHERE ${where}
     ORDER BY first_seen_at DESC`,
    values,
  );

  return result.rows;
};