import pool from "../config/db.config.js";

export async function saveBatteryLead(rows) {

  let inserted = 0;

  for (const row of rows) {

    if (!row.users || !row.user_id) continue;

    await pool.query(
      `
      INSERT INTO battery_producers (
        metal,
        user_id,
        legal_name,
        trade_name,
        state,
        email,
        address,
        epr_targets,
        credits_received
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (user_id, metal) DO UPDATE SET
        legal_name       = EXCLUDED.legal_name,
        trade_name       = EXCLUDED.trade_name,
        state            = EXCLUDED.state,
        email            = EXCLUDED.email,
        address          = EXCLUDED.address,
        epr_targets      = EXCLUDED.epr_targets,
        credits_received = EXCLUDED.credits_received,
        updated_at       = NOW()
      `,
      [
        "lead",
        row.user_id,
        row.users?.legal_name,
        row.users?.trade_name,
        row.users?.state_name,
        row.email,
        row.reg_address,
        row.epr_targets,
        row.credits_received
      ]
    );

    inserted++;

  }

  return inserted;

}