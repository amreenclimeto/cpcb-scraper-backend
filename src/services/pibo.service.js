import pool from "../config/db.config.js";
import { extractState } from "../utils/extractState.js";
import { parseStatesParam } from "../utils/helperFun.js";

/** DB में state खाली हो तो response में address से derive करो */
function resolvedState(row) {
  if (row.state != null && String(row.state).trim() !== "") return row.state;
  return extractState(row.address);
}

/** PWP registered जैसा single/multi state filter (DB column + address fallback) */
function appendStateFilter(stateList, conditions, values, idx) {
  if (!stateList.length) return idx;

  const parts = [
    `UPPER(TRIM(COALESCE(state, ''))) = ANY(
      SELECT UPPER(unnest($${idx}::text[]))
    )`,
  ];
  values.push(stateList.map((s) => s.toUpperCase().trim()));
  idx++;

  for (const s of stateList) {
    parts.push(`address ILIKE $${idx}`);
    values.push(`%${s}%`);
    idx++;
  }

  conditions.push(`(${parts.join(" OR ")})`);
  return idx;
}

const BATCH_SIZE = 500;
const SAVE_STATEMENT_TIMEOUT_MS =
  Number(process.env.PIBO_SAVE_TIMEOUT_MS) || 300000;

function dedupePiboRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = Number(row.company_id);
    if (!id || Number.isNaN(id)) continue;
    map.set(id, row);
  }
  return [...map.values()];
}

async function batchInsertCompanies(client, batch, entityType, status) {
  if (!batch.length) return;

  await client.query(
    `INSERT INTO pibo_companies
      (company_id, company, address, state, email, entity_type, status,
       is_new, first_seen_at, last_seen_at, synced_at)
     SELECT
       u.company_id, u.company, u.address, u.state, u.email,
       $7, $8, u.is_new, NOW(), NOW(), NOW()
     FROM UNNEST(
       $1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::bool[]
     ) AS u(company_id, company, address, state, email, is_new)
     ON CONFLICT (company_id) DO UPDATE SET
       company = EXCLUDED.company,
       address = EXCLUDED.address,
       state = EXCLUDED.state,
       email = COALESCE(EXCLUDED.email, pibo_companies.email),
       entity_type = EXCLUDED.entity_type,
       status = EXCLUDED.status,
       last_seen_at = NOW(),
       synced_at = NOW()`,
    [
      batch.map((r) => r.id),
      batch.map((r) => r.company),
      batch.map((r) => r.address),
      batch.map((r) => r.state),
      batch.map((r) => r.email),
      batch.map((r) => r.flagNew),
      entityType,
      status,
    ],
  );
}

async function batchUpdateStatusChanges(client, batch, entityType, status) {
  if (!batch.length) return;

  await client.query(
    `UPDATE pibo_companies AS p
     SET status = $4,
         address = v.address,
         state = v.state,
         last_seen_at = NOW(),
         synced_at = NOW()
     FROM UNNEST($1::int[], $2::text[], $3::text[])
       AS v(company_id, address, state)
     WHERE p.company_id = v.company_id
       AND p.entity_type = $5`,
    [
      batch.map((r) => r.id),
      batch.map((r) => r.address),
      batch.map((r) => r.state),
      status,
      entityType,
    ],
  );
}

async function batchTouchCompanies(client, batch, entityType) {
  if (!batch.length) return;

  await client.query(
    `UPDATE pibo_companies AS p
     SET address = v.address,
         state = v.state,
         last_seen_at = NOW(),
         synced_at = NOW()
     FROM UNNEST($1::int[], $2::text[], $3::text[])
       AS v(company_id, address, state)
     WHERE p.company_id = v.company_id
       AND p.entity_type = $4`,
    [
      batch.map((r) => r.id),
      batch.map((r) => r.address),
      batch.map((r) => r.state),
      entityType,
    ],
  );
}

async function batchInsertHistory(client, batch, entityType) {
  if (!batch.length) return;

  await client.query(
    `INSERT INTO pibo_status_history (company_id, entity_type, old_status, new_status)
     SELECT u.company_id, $4, u.old_status, u.new_status
     FROM UNNEST($1::int[], $2::text[], $3::text[])
       AS u(company_id, old_status, new_status)`,
    [
      batch.map((r) => r.id),
      batch.map((r) => r.oldStatus),
      batch.map((r) => r.newStatus),
      entityType,
    ],
  );
}

// ─── Save scraped data to DB ──────────────────────────────────────────────────
export const savePiboData = async (rows, entityType, status) => {
  const client = await pool.connect();
  const deduped = dedupePiboRows(rows);

  if (deduped.length < rows.length) {
    console.log(
      `🔍 [${entityType}] Deduped API rows: ${rows.length} → ${deduped.length}`,
    );
  }

  try {
    await client.query(
      `SET LOCAL statement_timeout = '${SAVE_STATEMENT_TIMEOUT_MS}ms'`,
    );
    await client.query("BEGIN");

    const baselineResult = await client.query(
      `SELECT baseline_count FROM pibo_baseline WHERE entity_type = $1`,
      [entityType],
    );
    const isFirstScrape = baselineResult.rows.length === 0;

    const existing = await client.query(
      `SELECT company_id, status FROM pibo_companies WHERE entity_type = $1`,
      [entityType],
    );

    const existingMap = new Map();
    existing.rows.forEach((r) =>
      existingMap.set(Number(r.company_id), r.status),
    );

    const toInsert = [];
    const toStatusChange = [];
    const toTouch = [];
    const historyRows = [];
    let newCompanies = 0;
    let statusChanges = 0;

    for (const item of deduped) {
      const id = Number(item.company_id);
      const oldStatus = existingMap.get(id);
      const state = extractState(item.address);
      const email = item.email !== "***" ? item.email : null;

      if (!existingMap.has(id)) {
        const flagNew = !isFirstScrape;
        if (flagNew) newCompanies++;

        toInsert.push({
          id,
          company: item.company,
          address: item.address,
          state,
          email,
          flagNew,
        });
        historyRows.push({ id, oldStatus: null, newStatus: status });
      } else if (oldStatus !== status) {
        statusChanges++;
        toStatusChange.push({ id, address: item.address, state });
        historyRows.push({ id, oldStatus, newStatus: status });
      } else {
        toTouch.push({ id, address: item.address, state });
      }
    }

    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      await batchInsertCompanies(
        client,
        toInsert.slice(i, i + BATCH_SIZE),
        entityType,
        status,
      );
    }

    for (let i = 0; i < toStatusChange.length; i += BATCH_SIZE) {
      await batchUpdateStatusChanges(
        client,
        toStatusChange.slice(i, i + BATCH_SIZE),
        entityType,
        status,
      );
    }

    for (let i = 0; i < toTouch.length; i += BATCH_SIZE) {
      await batchTouchCompanies(
        client,
        toTouch.slice(i, i + BATCH_SIZE),
        entityType,
      );
    }

    for (let i = 0; i < historyRows.length; i += BATCH_SIZE) {
      await batchInsertHistory(
        client,
        historyRows.slice(i, i + BATCH_SIZE),
        entityType,
      );
    }

    if (isFirstScrape) {
      await client.query(
        `INSERT INTO pibo_baseline (entity_type, baseline_count, set_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (entity_type)
         DO UPDATE SET baseline_count = $2, set_at = NOW()`,
        [entityType, deduped.length],
      );
      console.log(`📌 Baseline set for ${entityType}: ${deduped.length}`);
    }

    await client.query("COMMIT");
    console.log(
      `✅ [${entityType}] Saved ${deduped.length} rows (new: ${newCompanies}, status changes: ${statusChanges})`,
    );

    return {
      total: deduped.length,
      newCompanies,
      statusChanges,
      isFirstScrape,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`❌ [${entityType}] DB error, rolled back: ${err.message}`);
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
  states,
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
    const trimmed = search.trim();

    conditions.push(`(
    company ILIKE $${idx}
    OR address ILIKE $${idx}
    OR state ILIKE $${idx}
    OR entity_type ILIKE $${idx}
  )`);
    values.push(`%${trimmed}%`);
    idx++;
  }

  idx = appendStateFilter(parseStatesParam(states), conditions, values, idx);

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
      `SELECT company_id, company, address, state, entity_type,
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
    records: dataResult.rows.map((row) => ({
      ...row,
      state: resolvedState(row),
    })),
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
  states,
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
      OR state ILIKE $${idx}
      OR entity_type ILIKE $${idx}
    )`);
    values.push(`%${trimmed}%`);
    idx++;
  }

  idx = appendStateFilter(parseStatesParam(states), conditions, values, idx);

  if (date) {
    conditions.push(`DATE(first_seen_at) = $${idx++}`);
    values.push(date);
  } else if (from_date && to_date) {
    conditions.push(`DATE(first_seen_at) BETWEEN $${idx++} AND $${idx++}`);
    values.push(from_date, to_date);
  }

  const where = conditions.join(" AND ");

  const result = await pool.query(
    `SELECT company_id, company, address, state, entity_type,
            status, is_new, first_seen_at
     FROM pibo_companies
     WHERE ${where}
     ORDER BY first_seen_at DESC`,
    values,
  );

  return result.rows.map((row) => ({
    ...row,
    state: resolvedState(row),
  }));
};