import pool from "../config/db.config.js";


/* SAVE SCRAPED DATA */

export async function saveScrapedData(rows) {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT reg_id, status FROM plasticwastemanagement`
    );

    const existingMap = new Map();
    existing.rows.forEach(r => existingMap.set(r.reg_id, r.status));

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
            row.created_on
          ]
        );

        await client.query(
          `
          INSERT INTO plastic_status_history
          (reg_id, old_status, new_status)
          VALUES ($1,NULL,$2)
          `,
          [row.reg_id, newStatus]
        );

      }

      /* STATUS CHANGE */

      else if (oldStatus !== newStatus) {

        statusChanges++;

        await client.query(
          `
          INSERT INTO plastic_status_history
          (reg_id, old_status, new_status)
          VALUES ($1,$2,$3)
          `,
          [row.reg_id, oldStatus, newStatus]
        );

        await client.query(
          `
          UPDATE plasticwastemanagement
          SET status=$2,
              last_seen_at=NOW(),
              synced_at=NOW()
          WHERE reg_id=$1
          `,
          [row.reg_id, newStatus]
        );

      }

      /* NO CHANGE */

      else {

        await client.query(
          `
          UPDATE plasticwastemanagement
          SET last_seen_at=NOW(),
              synced_at=NOW()
          WHERE reg_id=$1
          `,
          [row.reg_id]
        );

      }

    }

    await client.query("COMMIT");

    return {
      newUsers,
      statusChanges,
      total: rows.length
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

export async function getNewCompaniesService(days) {

  const { rows } = await pool.query(
    `
    SELECT *
    FROM plasticwastemanagement
    WHERE first_seen_at >= NOW() - INTERVAL '${days} days'
    ORDER BY first_seen_at DESC
    `
  );

  return rows;

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
    `
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
    [regId]
  );

  return rows;

}