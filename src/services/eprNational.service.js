import pool from "../config/db.config.js";

/* SAVE SCRAPED DATA */

export async function saveScrapedData(rows) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT reg_id, status FROM plasticwastemanagement`,
    );

    const existingMap = new Map();
    existing.rows.forEach((r) => existingMap.set(r.reg_id, r.status));

    let newUsers = 0;
    let statusChanges = 0;

    for (const row of rows) {
      const oldStatus = existingMap.get(row.reg_id);
      const newStatus = row.status;

      const isNewUser = !existingMap.has(row.reg_id);

      /* NEW USER */

      if (isNewUser) {
        newUsers++;

        await client.query(
          `
          INSERT INTO plasticwastemanagement(
            reg_id,
            application_id,
            company_legal_name,
            company_trade_name,
            applicant_type,
            status,
            created_on,
            first_seen_at,
            last_seen_at,
            synced_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),NOW())
          `,
          [
            row.reg_id,
            row.application_id,
            row.company_legal_name,
            row.company_trade_name,
            row.applicant_type,
            row.status,
            row.created_on,
          ],
        );

        await client.query(
          `
          INSERT INTO plastic_status_history
          (reg_id, old_status, new_status)
          VALUES ($1,NULL,$2)
          `,
          [row.reg_id, newStatus],
        );
      } else if (oldStatus !== newStatus) {

      /* STATUS CHANGE */
        statusChanges++;

        await client.query(
          `
          INSERT INTO plastic_status_history
          (reg_id, old_status, new_status)
          VALUES ($1,$2,$3)
          `,
          [row.reg_id, oldStatus, newStatus],
        );

        await client.query(
          `
          UPDATE plasticwastemanagement
          SET status=$2,
              last_seen_at=NOW(),
              synced_at=NOW()
          WHERE reg_id=$1
          `,
          [row.reg_id, newStatus],
        );
      } else {

      /* NO CHANGE */
        await client.query(
          `
          UPDATE plasticwastemanagement
          SET last_seen_at=NOW(),
              synced_at=NOW()
          WHERE reg_id=$1
          `,
          [row.reg_id],
        );
      }
    }

    await client.query("COMMIT");

    return {
      newUsers,
      statusChanges,
      total: rows.length,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/* CURRENT DATA */

export async function getCurrentDataService() {
  const { rows } = await pool.query(`
    SELECT *
    FROM plasticwastemanagement
    ORDER BY created_on DESC
  `);

  return rows;
}

/* NEW COMPANIES */

/* NEW COMPANIES - cursor based */
export async function getNewCompaniesService() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Last cursor fetch karo
    const cursorResult = await client.query(
      `SELECT last_seen_at, last_total_count 
       FROM sync_cursors 
       WHERE cursor_key = 'epr_national_new_companies'`
    );

    const lastSeenAt = cursorResult.rows[0]?.last_seen_at ?? new Date(0);
    const lastTotalCount = cursorResult.rows[0]?.last_total_count ?? 0;

    // Current total
    const countResult = await client.query(
      `SELECT COUNT(*) as total FROM plasticwastemanagement`
    );
    const currentTotal = parseInt(countResult.rows[0].total);

    // Naye records
    const { rows } = await client.query(
      `SELECT * FROM plasticwastemanagement
       WHERE first_seen_at > $1
       ORDER BY first_seen_at ASC`,
      [lastSeenAt]
    );

    // Cursor update karo agar naye records mile
    if (rows.length > 0) {
      await client.query(
        `UPDATE sync_cursors
         SET last_seen_at = NOW(), last_total_count = $1
         WHERE cursor_key = 'epr_national_new_companies'`,
        [currentTotal]
      );
    }

    await client.query("COMMIT");

    return {
      previousTotal: lastTotalCount,
      currentTotal,
      newCount: rows.length,
      data: rows,
    };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/* STATUS CHANGES */

export async function getRecentStatusChangesService(days) {
  const { rows } = await pool.query(
    `
    SELECT
      h.reg_id,
      p.company_legal_name,
      p.applicant_type,
      h.old_status,
      h.new_status,
      h.changed_at
    FROM plastic_status_history h
    JOIN plasticwastemanagement p
    ON p.reg_id = h.reg_id
    WHERE h.changed_at >= NOW() - INTERVAL '${days} days'
    ORDER BY h.changed_at DESC
    `,
  );

  return rows;
}

/* STATUS HISTORY */

export async function getStatusHistoryService(regId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM plastic_status_history
    WHERE reg_id=$1
    ORDER BY changed_at ASC
    `,
    [regId],
  );

  return rows;
}

// eprNational.service.js mein add karo
export async function getLatestCreatedOn() {
  const { rows } = await pool.query(
    `SELECT MAX(created_on) as latest FROM plasticwastemanagement`
  );
  return rows[0]?.latest ?? null;
}