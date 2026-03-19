import pool from "../config/db.config.js";


// GET new companies — cursor based
export async function getPwpNewCompaniesService() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const cursorResult = await client.query(
      `SELECT last_seen_at, last_total_count
       FROM sync_cursors
       WHERE cursor_key = 'pwp_new_companies'`
    );

    const lastSeenAt = cursorResult.rows[0]?.last_seen_at ?? new Date(0);
    const lastTotalCount = cursorResult.rows[0]?.last_total_count ?? 0;

    const countResult = await client.query(
      `SELECT COUNT(*) as total FROM pwp_companies`
    );
    const currentTotal = parseInt(countResult.rows[0].total);

    const { rows } = await client.query(
      `SELECT * FROM pwp_companies
       WHERE first_seen_at > $1
       ORDER BY first_seen_at ASC`,
      [lastSeenAt]
    );

    if (rows.length > 0) {
      await client.query(
        `UPDATE sync_cursors
         SET last_seen_at = NOW(), last_total_count = $1
         WHERE cursor_key = 'pwp_new_companies'`,
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

// GET status changes — aaj ke
export async function getPwpStatusChangesService() {
  const { rows } = await pool.query(
    `SELECT
      h.company_id,
      p.company,
      p.state,
      p.category,
      p.class,
      p.address,
      h.old_status,
      h.new_status,
      h.changed_at
     FROM pwp_status_history h
     JOIN pwp_companies p ON p.company_id = h.company_id
     WHERE DATE(h.changed_at) = CURRENT_DATE
     AND h.old_status IS NOT NULL
     ORDER BY h.changed_at DESC`
  );

  return rows;
}