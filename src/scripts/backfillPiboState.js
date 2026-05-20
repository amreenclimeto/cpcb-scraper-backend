import pool from "../config/db.config.js";
import { extractState } from "../utils/extractState.js";

async function backfillPiboState() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT company_id, address FROM pibo_companies WHERE state IS NULL OR state = ''`,
    );

    let updated = 0;
    for (const row of rows) {
      const state = extractState(row.address);
      await client.query(
        `UPDATE pibo_companies SET state = $2 WHERE company_id = $1`,
        [row.company_id, state],
      );
      updated++;
    }

    console.log(`Backfilled state for ${updated} pibo_companies rows.`);
  } finally {
    client.release();
    await pool.end();
  }
}

backfillPiboState().catch((err) => {
  console.error(err);
  process.exit(1);
});
