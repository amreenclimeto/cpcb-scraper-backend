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
export async function getNewAfterBaselineService(statusFilter = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Baseline info — YE VALUE KABHI NAHI BADLEGI
    const baselineRes = await client.query(
      `SELECT last_total_count, last_seen_at
       FROM sync_cursors
       WHERE cursor_key = 'epr_national_baseline'`
    );
    const baselineCount = baselineRes.rows[0]?.last_total_count ?? 0;
    const baselineSetAt = baselineRes.rows[0]?.last_seen_at ?? null;

    // Current total
    const countRes = await client.query(
      `SELECT COUNT(*) as total FROM plasticwastemanagement`
    );
    const currentTotal = parseInt(countRes.rows[0].total);

    // Dynamic query — status filter optional
    let queryText = `
      SELECT
        reg_id, application_id,
        company_legal_name, company_trade_name,
        applicant_type, status,
        created_on, first_seen_at, synced_at
      FROM plasticwastemanagement
      WHERE is_new_after_baseline = TRUE
    `;
    const queryParams = [];

    if (statusFilter) {
      queryParams.push(`%${statusFilter}%`);
      queryText += ` AND status ILIKE $1`;
    }

    queryText += ` ORDER BY first_seen_at DESC`;

    const { rows } = await client.query(queryText, queryParams);

    await client.query("COMMIT");

    return {
      baselineCount,                              // 🔒 pehli scrape ka count — FIXED FOREVER
      baselineSetAt,
      currentTotal,
      addedAfterBaseline: currentTotal - baselineCount,
      filteredCount: rows.length,
      appliedFilter: statusFilter ?? "all",
      data: rows,
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

export async function getCurrentDataService() {
  const { rows } = await pool.query(
    `SELECT * FROM plasticwastemanagement ORDER BY created_on DESC`
  );
  return rows;
}

export async function getNewCompaniesService() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const cursorResult = await client.query(
      `SELECT last_seen_at, last_total_count
       FROM sync_cursors
       WHERE cursor_key = 'epr_national_new_companies'`
    );

    const lastSeenAt = cursorResult.rows[0]?.last_seen_at ?? new Date(0);
    const lastTotalCount = cursorResult.rows[0]?.last_total_count ?? 0;

    const countResult = await client.query(
      `SELECT COUNT(*) as total FROM plasticwastemanagement`
    );
    const currentTotal = parseInt(countResult.rows[0].total);

    const { rows } = await client.query(
      `SELECT * FROM plasticwastemanagement
       WHERE first_seen_at > $1
       ORDER BY first_seen_at ASC`,
      [lastSeenAt]
    );

    if (rows.length > 0) {
      await client.query(
        `UPDATE sync_cursors
         SET last_seen_at = NOW(), last_total_count = $1
         WHERE cursor_key = 'epr_national_new_companies'`,
        [currentTotal]
      );
    }

    await client.query("COMMIT");

    return { previousTotal: lastTotalCount, currentTotal, newCount: rows.length, data: rows };

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