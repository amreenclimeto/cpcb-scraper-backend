import pool from "../config/db.config.js";

export async function upsertBatteryProducer(row) {

  if (!row.user_id || !row.users) return;

  await pool.query(
    `
    INSERT INTO battery_producers_metal (
      user_id,
      legal_name,
      trade_name,
      state,
      email,
      address
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE SET
      legal_name = EXCLUDED.legal_name,
      trade_name = EXCLUDED.trade_name,
      state      = EXCLUDED.state,
      email      = EXCLUDED.email,
      address    = EXCLUDED.address,
      updated_at = NOW()
    `,
    [
      row.user_id,
      row.users?.legal_name,
      row.users?.trade_name,
      row.users?.state_name,
      row.email,
      row.reg_address
    ]
  );

}