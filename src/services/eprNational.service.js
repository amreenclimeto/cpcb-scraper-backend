import pool from "../config/db.config.js";

// ─────────────────────────────────────────────────────────
// HELPER: Baseline count fetch karo
// ─────────────────────────────────────────────────────────
async function getBaselineCount(client) {
  const res = await client.query(
    `SELECT last_total_count FROM sync_cursors WHERE cursor_key = 'epr_national_baseline'`
  );
  return res.rows[0]?.last_total_count ?? null;
}

// ─────────────────────────────────────────────────────────
// HELPER: Baseline SIRF PEHLI BAAR set karo — KABHI UPDATE NAHI
// last_total_count = 0 matlab abhi set nahi hua
// Ek baar set hone ke baad ye query silently skip ho jaati hai
// ─────────────────────────────────────────────────────────
async function setBaselineIfNeeded(client, totalCount) {
  const result = await client.query(
    `UPDATE sync_cursors
     SET last_total_count = $1,
         last_seen_at     = NOW()
     WHERE cursor_key        = 'epr_national_baseline'
       AND last_total_count  = 0`,
    [totalCount]
  );

  if (result.rowCount > 0) {
    console.log(`🔒 Baseline PERMANENTLY locked at: ${totalCount} (will never change)`);
  } else {
    console.log(`✅ Baseline already set — no update`);
  }
}

// ─────────────────────────────────────────────────────────
// SAVE SCRAPED DATA
// ─────────────────────────────────────────────────────────
export async function saveScrapedData(rows) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ── Baseline check ──────────────────────────────────
    const baselineCount = await getBaselineCount(client);
    const isFirstScrape = baselineCount === 0 || baselineCount === null;

    console.log(`📌 Baseline: ${baselineCount} | First scrape: ${isFirstScrape}`);

    // ── Existing records ─────────────────────────────────
    const existing = await client.query(
      `SELECT reg_id, status FROM plasticwastemanagement`
    );
    const existingMap = new Map();
    existing.rows.forEach((r) => existingMap.set(r.reg_id, r.status));

    let newUsers = 0;
    let statusChanges = 0;

    for (const row of rows) {
      const oldStatus = existingMap.get(row.reg_id);
      const newStatus = row.status;
      const isNewUser = !existingMap.has(row.reg_id);

      // Pehli scrape → FALSE (ye baseline records hain)
      // Baad ki scrapes mein naye records → TRUE
      const isNewAfterBaseline = !isFirstScrape && isNewUser;

      if (isNewUser) {
        newUsers++;

        await client.query(
          `INSERT INTO plasticwastemanagement (
              reg_id, application_id, company_legal_name, company_trade_name,
              applicant_type, status, created_on,
              first_seen_at, last_seen_at, synced_at,
              is_new_after_baseline
            ) VALUES ($1,$2,$3,$4,$5,$6,$7, NOW(),NOW(),NOW(), $8)`,
          [
            row.reg_id,
            row.application_id,
            row.company_legal_name,
            row.company_trade_name,
            row.applicant_type,
            row.status,
            row.created_on,
            isNewAfterBaseline,
          ]
        );

        await client.query(
          `INSERT INTO plastic_status_history (reg_id, old_status, new_status)
           VALUES ($1, NULL, $2)`,
          [row.reg_id, newStatus]
        );

      } else if (oldStatus !== newStatus) {
        statusChanges++;

        await client.query(
          `INSERT INTO plastic_status_history (reg_id, old_status, new_status)
           VALUES ($1, $2, $3)`,
          [row.reg_id, oldStatus, newStatus]
        );

        await client.query(
          `UPDATE plasticwastemanagement
           SET status=$2, last_seen_at=NOW(), synced_at=NOW()
           WHERE reg_id=$1`,
          [row.reg_id, newStatus]
        );

      } else {
        await client.query(
          `UPDATE plasticwastemanagement
           SET last_seen_at=NOW(), synced_at=NOW()
           WHERE reg_id=$1`,
          [row.reg_id]
        );
      }
    }

    // ── Pehli scrape complete → baseline PERMANENTLY lock karo ──
    if (isFirstScrape) {
      const finalCount = existingMap.size + newUsers;
      await setBaselineIfNeeded(client, finalCount);
    }

    await client.query("COMMIT");

    return { newUsers, statusChanges, total: rows.length, isFirstScrape };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────
// GET: Naye records after baseline
//
// statusFilter optional:
//   undefined/null  → saare naye records (all statuses)
//   'Approved'      → sirf approved
//   'Pending'       → sirf pending
//   koi bhi string  → ILIKE %value% match
// ─────────────────────────────────────────────────────────
export async function getNewAfterBaselineService({
  page,
  limit,
  statusFilter,
  search,
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const offset = (page - 1) * limit;

    // 🔒 Baseline info
    const baselineRes = await client.query(
      `SELECT last_total_count, last_seen_at
       FROM sync_cursors
       WHERE cursor_key = 'epr_national_baseline'`
    );

    const baselineCount = baselineRes.rows[0]?.last_total_count ?? 0;
    const baselineSetAt = baselineRes.rows[0]?.last_seen_at ?? null;

    // 🔹 Current total
    const countRes = await client.query(
      `SELECT COUNT(*) FROM plasticwastemanagement`
    );
    const currentTotal = Number(countRes.rows[0].count);

    // 🔥 Base Query
    let baseQuery = `
      FROM plasticwastemanagement
      WHERE is_new_after_baseline = TRUE
    `;

    const values = [];
    let index = 1;

    // ✅ Status filter
    if (statusFilter) {
      baseQuery += ` AND status ILIKE $${index}`;
      values.push(`%${statusFilter}%`);
      index++;
    }

    // ✅ Search filter
    if (search) {
      baseQuery += ` AND (
        company_legal_name ILIKE $${index}
        OR company_trade_name ILIKE $${index}
      )`;
      values.push(`%${search}%`);
      index++;
    }

    // 🔹 Total count (filtered)
    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await client.query(countQuery, values);
    const total = Number(countResult.rows[0].count);

    // 🔹 Data query (paginated)
    const dataQuery = `
      SELECT
        reg_id, application_id,
        company_legal_name, company_trade_name,
        applicant_type, status,
        created_on, first_seen_at, synced_at
      ${baseQuery}
      ORDER BY first_seen_at DESC
      LIMIT $${index} OFFSET $${index + 1}
    `;

    const dataResult = await client.query(dataQuery, [
      ...values,
      limit,
      offset,
    ]);

    await client.query("COMMIT");

    return {
      baselineCount,
      baselineSetAt,
      currentTotal,
      addedAfterBaseline: currentTotal - baselineCount,
      filteredCount: total,
      appliedFilter: statusFilter ?? "all",

      // ✅ pagination
      total,
      page,
      limit,

      data: dataResult.rows,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────
// EXISTING SERVICES (unchanged)
// ─────────────────────────────────────────────────────────

export async function getCurrentDataService({
  page,
  limit,
  entityType,
  status,
  search,
}) {
  const offset = (page - 1) * limit;

  let query = `SELECT * FROM plasticwastemanagement WHERE 1=1`;
  let countQuery = `SELECT COUNT(*) FROM plasticwastemanagement WHERE 1=1`;

  const values = [];
  let index = 1;

  // ✅ Entity Type Filter
  if (entityType) {
    query += ` AND applicant_type = $${index}`;
    countQuery += ` AND applicant_type = $${index}`;
    values.push(entityType);
    index++;
  }

  // ✅ Status Filter
  if (status) {
    query += ` AND status = $${index}`;
    countQuery += ` AND status = $${index}`;
    values.push(status);
    index++;
  }

  // ✅ Search (legal + trade name)
  if (search) {
    query += ` AND (
      company_legal_name ILIKE $${index}
      OR company_trade_name ILIKE $${index}
    )`;
    countQuery += ` AND (
      company_legal_name ILIKE $${index}
      OR company_trade_name ILIKE $${index}
    )`;
    values.push(`%${search}%`);
    index++;
  }

  // ✅ Pagination
  query += ` ORDER BY created_on DESC LIMIT $${index} OFFSET $${index + 1}`;
  values.push(limit, offset);

  // 🔥 Execute queries
  const dataPromise = pool.query(query, values);
  const countPromise = pool.query(countQuery, values.slice(0, index - 1));

  const [dataResult, countResult] = await Promise.all([
    dataPromise,
    countPromise,
  ]);

  return {
    total: Number(countResult.rows[0].count),
    page,
    limit,
    data: dataResult.rows,
  };
}

export async function getNewCompaniesService({
  page,
  limit,
  entityType,
  status,
  search,
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const offset = (page - 1) * limit;

    // 🔹 Cursor fetch
    const cursorResult = await client.query(
      `SELECT last_seen_at, last_total_count
       FROM sync_cursors
       WHERE cursor_key = 'epr_national_new_companies'`
    );

    const lastSeenAt = cursorResult.rows[0]?.last_seen_at ?? new Date(0);
    const lastTotalCount = cursorResult.rows[0]?.last_total_count ?? 0;

    // 🔹 Current total
    const countAllResult = await client.query(
      `SELECT COUNT(*) FROM plasticwastemanagement`
    );
    const currentTotal = Number(countAllResult.rows[0].count);

    // 🔥 Dynamic Query
    let baseQuery = `FROM plasticwastemanagement WHERE first_seen_at > $1`;
    let values = [lastSeenAt];
    let index = 2;

    // ✅ Entity filter
    if (entityType) {
      baseQuery += ` AND applicant_type = $${index}`;
      values.push(entityType);
      index++;
    }

    // ✅ Status filter
    if (status) {
      baseQuery += ` AND status = $${index}`;
      values.push(status);
      index++;
    }

    // ✅ Search
    if (search) {
      baseQuery += ` AND (
        company_legal_name ILIKE $${index}
        OR company_trade_name ILIKE $${index}
      )`;
      values.push(`%${search}%`);
      index++;
    }

    // 🔹 Count (filtered new companies)
    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await client.query(countQuery, values);
    const total = Number(countResult.rows[0].count);

    // 🔹 Data query (paginated)
    const dataQuery = `
      SELECT *
      ${baseQuery}
      ORDER BY first_seen_at ASC
      LIMIT $${index} OFFSET $${index + 1}
    `;

    const dataResult = await client.query(dataQuery, [
      ...values,
      limit,
      offset,
    ]);

    // 🔥 Update cursor only if FIRST PAGE hit (important)
    if (page === 1 && dataResult.rows.length > 0) {
      await client.query(
        `UPDATE sync_cursors
         SET last_seen_at = NOW(), last_total_count = $1
         WHERE cursor_key = 'epr_national_new_companies'`,
        [currentTotal]
      );
    }

    await client.query("COMMIT");

    return {
      summary: {
        previousTotal: lastTotalCount,
        currentTotal,
        newCount: total,
      },
      total,
      page,
      limit,
      data: dataResult.rows,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getRecentStatusChangesService() {
  const { rows } = await pool.query(
    `SELECT
        h.reg_id, h.old_status, h.new_status, h.changed_at,
        p.application_id, p.company_legal_name, p.company_trade_name,
        p.applicant_type, p.created_on, p.first_seen_at
     FROM plastic_status_history h
     JOIN plasticwastemanagement p ON p.reg_id = h.reg_id
     WHERE DATE(h.changed_at) = CURRENT_DATE
       AND h.old_status IS NOT NULL
     ORDER BY h.changed_at DESC`
  );
  return rows;
}

export async function getStatusHistoryService(regId) {
  const { rows } = await pool.query(
    `SELECT * FROM plastic_status_history
     WHERE reg_id=$1 ORDER BY changed_at ASC`,
    [regId]
  );
  return rows;
}

export async function getLatestCreatedOn() {
  const { rows } = await pool.query(
    `SELECT MAX(created_on) as latest FROM plasticwastemanagement`
  );
  return rows[0]?.latest ?? null;
}

export async function getTotalCount() {
  const { rows } = await pool.query(
    `SELECT COUNT(*) as total FROM plasticwastemanagement`
  );
  return parseInt(rows[0].total);
}