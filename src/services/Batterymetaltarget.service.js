import pool from "../config/db.config.js";

export async function processBatteryMetalTarget(row, metalType) {

  const userId     = row.user_id;
  const newTarget  = parseFloat(row.epr_targets)      || 0;
  const newCredits = parseFloat(row.credits_received) || 0;

  // Check existing record
  const { rows: existing } = await pool.query(
    `
    SELECT epr_target, credits_received
    FROM battery_producer_metal_targets_current
    WHERE user_id = $1 AND metal_type = $2
    `,
    [userId, metalType]
  );

  if (existing.length === 0) {

    // New record — insert only, no history
    await pool.query(
      `
      INSERT INTO battery_producer_metal_targets_current (
        user_id,
        metal_type,
        epr_target,
        credits_received,
        last_scraped_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      `,
      [userId, metalType, newTarget, newCredits]
    );

    return "inserted";

  }

  const oldTarget  = parseFloat(existing[0].epr_target)       || 0;
  const oldCredits = parseFloat(existing[0].credits_received)  || 0;

  const targetChanged  = oldTarget  !== newTarget;
  const creditsChanged = oldCredits !== newCredits;

  if (!targetChanged && !creditsChanged) return "unchanged";

  // Insert into history
  await pool.query(
    `
    INSERT INTO battery_producer_metal_targets_history (
      user_id,
      metal_type,
      old_target,
      new_target,
      target_diff,
      old_credits,
      new_credits,
      credits_diff,
      changed_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `,
    [
      userId,
      metalType,
      oldTarget,
      newTarget,
      newTarget  - oldTarget,
      oldCredits,
      newCredits,
      newCredits - oldCredits
    ]
  );

  // Update current table
  await pool.query(
    `
    UPDATE battery_producer_metal_targets_current
    SET
      epr_target       = $1,
      credits_received = $2,
      last_scraped_at  = NOW()
    WHERE user_id = $3 AND metal_type = $4
    `,
    [newTarget, newCredits, userId, metalType]
  );

  return "updated";

}