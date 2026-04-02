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
      row.reg_address,
    ],
  );
}

export async function getMetalDashboardService({
  page = 1,
  limit = 10,
  metal,
  search,
}) {
  const offset = (page - 1) * limit;

  const values = [];
  let where = [];

  // 🔍 Metal filter
  if (metal) {
    values.push(metal);
    where.push(`c.metal_type = $${values.length}`);
  }

  // 🔍 Search (name / state)
  if (search) {
    values.push(`%${search}%`);
    where.push(`(
      p.legal_name ILIKE $${values.length} OR
      p.trade_name ILIKE $${values.length} OR
      p.state ILIKE $${values.length}
    )`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // ✅ MAIN QUERY
  const query = `
    SELECT 
      p.user_id,
      p.legal_name,
      p.trade_name,
      p.state,
      p.address,

      c.metal_type,
      c.epr_target,
      c.credits_received,
      c.last_scraped_at, 
      CASE 
        WHEN c.credits_received > 0 THEN 1
        ELSE 0
      END AS is_active,

      h.target_diff,
      h.credits_diff,
      h.changed_at

    FROM battery_producer_metal_targets_current c

    LEFT JOIN battery_producers_metal p 
      ON p.user_id = c.user_id

    LEFT JOIN LATERAL (
      SELECT *
      FROM battery_producer_metal_targets_history h
      WHERE h.user_id = c.user_id 
        AND h.metal_type = c.metal_type
      ORDER BY h.changed_at DESC
      LIMIT 1
    ) h ON true

    ${whereClause}

    ORDER BY 
      is_active DESC,                     -- ✅ active first
      c.credits_received DESC,           -- ✅ higher credits first
      c.epr_target DESC,                 -- ✅ then target
      h.credits_diff DESC NULLS LAST     -- ✅ increasing data top

    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*) 
    FROM battery_producer_metal_targets_current c
    LEFT JOIN battery_producers_metal p 
      ON p.user_id = c.user_id
    ${whereClause}
  `;

  const data = await pool.query(query, [...values, limit, offset]);
  const count = await pool.query(countQuery, values);

  return {
    data: data.rows,
    total: parseInt(count.rows[0].count),
    page,
    limit,
    totalPages: Math.ceil(count.rows[0].count / limit),
  };
}
