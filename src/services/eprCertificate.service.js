import { v4 as uuidv4 } from "uuid";
import { fetchEprCertificates } from "../scraper/eprCertificate.scraper.js";
import db from "../config/db.config.js"; // your pg pool / client

export const runEprScraper = async () => {
  const client = await db.connect();

  try {
    const data = await fetchEprCertificates();

    // 🔹 1. Create snapshot
    const snapshotId = uuidv4();

    await client.query(
      `INSERT INTO epr_pwp_cer_snapshots (id, created_at) VALUES ($1, NOW())`,
      [snapshotId]
    );

    // 🔹 2. Insert snapshot details
    for (const item of data) {
      await client.query(
        `INSERT INTO epr_pwp_cer_snapshot_details 
        (id, snapshot_id, category, generated, transferred, available)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          snapshotId,
          item.category,
          item.generated,
          item.transferred,
          item.available,
        ]
      );
    }

    // 🔹 3. Get previous snapshot
    const prevSnapshot = await client.query(
      `SELECT id FROM epr_pwp_cer_snapshots
       WHERE id != $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [snapshotId]
    );

    if (prevSnapshot.rows.length === 0) return;

    const prevId = prevSnapshot.rows[0].id;

    const prevData = await client.query(
      `SELECT * FROM epr_pwp_cer_snapshot_details WHERE snapshot_id = $1`,
      [prevId]
    );

    const prevMap = {};
    prevData.rows.forEach((row) => {
      prevMap[row.category] = row;
    });

    // 🔥 4. Calculate diff
    for (const item of data) {
      const prev = prevMap[item.category];

      const generatedDiff = prev ? item.generated - prev.generated : 0;
      const transferredDiff = prev ? item.transferred - prev.transferred : 0;
      const availableDiff = prev ? item.available - prev.available : 0;

      await client.query(
        `INSERT INTO epr_pwp_cer_deltas 
        (id, snapshot_id, category, generated_diff, transferred_diff, available_diff)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          snapshotId,
          item.category,
          generatedDiff,
          transferredDiff,
          availableDiff,
        ]
      );
    }

    return { success: true, snapshotId };
  } catch (err) {
    console.error("EPR Scraper Error:", err);
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────
// Get all snapshots grouped — for time-series chart
// params: { limit, category }
// ─────────────────────────────────────────────
export const getAuditHistoryService = async ({ limit = 10, category = null }) => {
  const snapshots = await db.query(
    `SELECT id, created_at
     FROM epr_pwp_cer_snapshots
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
 
  if (!snapshots.rows.length) return [];
 
  const snapshotIds = snapshots.rows.map((s) => s.id);
 
  const categoryFilter = category ? `AND s.category = $2` : "";
  const queryParams    = category ? [snapshotIds, category] : [snapshotIds];
 
  const rows = await db.query(
    `SELECT
       s.snapshot_id,
       s.category,
       s.generated,
       s.transferred,
       s.available,
       COALESCE(d.generated_diff, 0)   AS generated_diff,
       COALESCE(d.transferred_diff, 0) AS transferred_diff,
       COALESCE(d.available_diff, 0)   AS available_diff,
       snap.created_at                 AS snapshot_time
     FROM epr_pwp_cer_snapshot_details s
     LEFT JOIN epr_pwp_cer_deltas d
       ON s.snapshot_id = d.snapshot_id
       AND s.category   = d.category
     JOIN epr_pwp_cer_snapshots snap
       ON s.snapshot_id = snap.id
     WHERE s.snapshot_id = ANY($1)
     ${categoryFilter}
     ORDER BY snap.created_at ASC, s.category`,
    queryParams
  );
 
  // Group rows by snapshot
  const snapshotMap = {};
  for (const row of rows.rows) {
    const key = row.snapshot_id;
    if (!snapshotMap[key]) {
      snapshotMap[key] = {
        snapshot_id: key,
        time: row.snapshot_time,
        data: [],
      };
    }
    snapshotMap[key].data.push({
      category:         row.category,
      generated:        Number(row.generated),
      transferred:      Number(row.transferred),
      available:        Number(row.available),
      generated_diff:   Number(row.generated_diff),
      transferred_diff: Number(row.transferred_diff),
      available_diff:   Number(row.available_diff),
    });
  }
 
  return Object.values(snapshotMap).sort(
    (a, b) => new Date(a.time) - new Date(b.time)
  );
};
 
// ─────────────────────────────────────────────
// Get single category history across all snapshots
// ─────────────────────────────────────────────
export const getCategoryHistoryService = async (category) => {
  const rows = await db.query(
    `SELECT
       s.category,
       s.generated,
       s.transferred,
       s.available,
       COALESCE(d.generated_diff, 0)   AS generated_diff,
       COALESCE(d.transferred_diff, 0) AS transferred_diff,
       COALESCE(d.available_diff, 0)   AS available_diff,
       snap.created_at                 AS snapshot_time
     FROM epr_pwp_cer_snapshot_details s
     LEFT JOIN epr_pwp_cer_deltas d
       ON s.snapshot_id = d.snapshot_id
       AND s.category   = d.category
     JOIN epr_pwp_cer_snapshots snap
       ON s.snapshot_id = snap.id
     WHERE s.category = $1
     ORDER BY snap.created_at ASC`,
    [category]
  );
 
  return rows.rows.map((r) => ({
    snapshot_time:    r.snapshot_time,
    generated:        Number(r.generated),
    transferred:      Number(r.transferred),
    available:        Number(r.available),
    generated_diff:   Number(r.generated_diff),
    transferred_diff: Number(r.transferred_diff),
    available_diff:   Number(r.available_diff),
  }));
};