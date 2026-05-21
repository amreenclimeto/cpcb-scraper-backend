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
      const availableDiff = generatedDiff - transferredDiff;

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

function buildSnapshotDateFilter({ from, to }) {
  const snapWhere = [];
  const snapParams = [];
  const tz = process.env.SCRAPE_TIMEZONE || "Asia/Kolkata";
  if (from) {
    snapParams.push(from);
    snapWhere.push(`DATE(created_at AT TIME ZONE '${tz}') >= $${snapParams.length}::date`);
  }
  if (to) {
    snapParams.push(to);
    snapWhere.push(`DATE(created_at AT TIME ZONE '${tz}') <= $${snapParams.length}::date`);
  }
  const snapWhereSQL = snapWhere.length ? `WHERE ${snapWhere.join(" AND ")}` : "";
  return { snapWhereSQL, snapParams, tz };
}

const FILTERED_SNAPS_CTE = (snapWhereSQL) => `
  WITH filtered_snaps AS (
    SELECT id, created_at,
      LAG(id) OVER (ORDER BY created_at ASC) AS prev_snapshot_id
    FROM epr_pwp_cer_snapshots
    ${snapWhereSQL}
  )`;

async function queryAuditGrandTotals({ category, from, to, onlyChanged = false }) {
  const { snapWhereSQL, snapParams } = buildSnapshotDateFilter({ from, to });
  const params = [...snapParams];
  let categorySQL = "";
  if (category) {
    params.push(category);
    categorySQL = `AND s.category = $${params.length}`;
  }
  let onlyChangedSQL = "";
  if (onlyChanged) {
    onlyChangedSQL = `AND (
      COALESCE(s.generated - p.generated, 0) != 0
      OR COALESCE(s.transferred - p.transferred, 0) != 0
    )`;
  }

  const result = await db.query(
    `${FILTERED_SNAPS_CTE(snapWhereSQL)},
    diff_rows AS (
      SELECT
        COALESCE(s.generated - p.generated, 0) AS generated_diff,
        COALESCE(s.transferred - p.transferred, 0) AS transferred_diff
      FROM filtered_snaps fs
      JOIN epr_pwp_cer_snapshot_details s ON s.snapshot_id = fs.id
      LEFT JOIN epr_pwp_cer_snapshot_details p
        ON p.snapshot_id = fs.prev_snapshot_id AND p.category = s.category
      WHERE 1=1 ${categorySQL} ${onlyChangedSQL}
    )
    SELECT
      COALESCE(SUM(generated_diff), 0)::bigint AS generated,
      COALESCE(SUM(transferred_diff), 0)::bigint AS transferred,
      COALESCE(SUM(generated_diff - transferred_diff), 0)::bigint AS available
    FROM diff_rows`,
    params
  );

  const row = result.rows[0] || {};
  return {
    generated: Number(row.generated) || 0,
    transferred: Number(row.transferred) || 0,
    available: Number(row.available) || 0,
  };
}

// ─────────────────────────────────────────────
// Get all snapshots grouped — for time-series chart
// params: { limit, category }
// ─────────────────────────────────────────────
export const getAuditHistoryService = async ({
  limit = 10,
  page = 1,
  category = null,
  from = null,
  to = null,
  prevIntervalHours = 0,
  onlyChanged = false,
  includeTotals = true,
}) => {
  const offset = (page - 1) * limit;
  const { snapWhereSQL, snapParams } = buildSnapshotDateFilter({ from, to });

  const countResult = await db.query(
    `SELECT COUNT(*) AS total FROM epr_pwp_cer_snapshots ${snapWhereSQL}`,
    snapParams
  );
  const total = parseInt(countResult.rows[0].total);
  const totalPages = Math.ceil(total / limit);
  if (total === 0) {
    return {
      total: 0,
      totalPages: 0,
      currentPage: page,
      limit,
      data: [],
      grandTotals: { generated: 0, transferred: 0, available: 0 },
    };
  }

  const pageParams = [...snapParams, limit, offset];
  let categorySQL = "";
  if (category) {
    pageParams.push(category);
    categorySQL = `AND s.category = $${pageParams.length}`;
  }

  const pageLimitIdx = snapParams.length + 1;
  const pageOffsetIdx = snapParams.length + 2;

  const [rows, grandTotals] = await Promise.all([
    db.query(
      `${FILTERED_SNAPS_CTE(snapWhereSQL)},
      page AS (
        SELECT id, created_at, prev_snapshot_id
        FROM filtered_snaps
        ORDER BY created_at DESC
        LIMIT $${pageLimitIdx} OFFSET $${pageOffsetIdx}
      )
      SELECT
        page.id AS snapshot_id,
        page.created_at AS snapshot_time,
        s.category,
        s.generated,
        s.transferred,
        s.available,
        p.generated AS prev_generated,
        p.transferred AS prev_transferred,
        p.available AS prev_available,
        COALESCE(s.generated - p.generated, 0) AS generated_diff,
        COALESCE(s.transferred - p.transferred, 0) AS transferred_diff,
        COALESCE(s.generated - p.generated, 0) - COALESCE(s.transferred - p.transferred, 0) AS available_diff
      FROM page
      JOIN epr_pwp_cer_snapshot_details s ON s.snapshot_id = page.id
      LEFT JOIN epr_pwp_cer_snapshot_details p
        ON p.snapshot_id = page.prev_snapshot_id AND p.category = s.category
      WHERE 1=1 ${categorySQL}
      ORDER BY page.created_at DESC, s.category`,
      pageParams
    ),
    includeTotals
      ? queryAuditGrandTotals({ category, from, to, onlyChanged })
      : Promise.resolve(null),
  ]);

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
      category: row.category,
      generated: Number(row.generated),
      transferred: Number(row.transferred),
      available: Number(row.available),
      prev_generated: row.prev_generated != null ? Number(row.prev_generated) : null,
      prev_transferred: row.prev_transferred != null ? Number(row.prev_transferred) : null,
      prev_available: row.prev_available != null ? Number(row.prev_available) : null,
      generated_diff: Number(row.generated_diff),
      transferred_diff: Number(row.transferred_diff),
      available_diff: Number(row.available_diff),
    });
  }

  let data = Object.values(snapshotMap).sort((a, b) => new Date(b.time) - new Date(a.time));

  if (onlyChanged) {
    data = data
      .map((snap) => ({
        ...snap,
        data: snap.data.filter(
          (c) =>
            c.generated_diff !== 0 ||
            c.transferred_diff !== 0 ||
            c.available_diff !== 0
        ),
      }))
      .filter((snap) => snap.data.length > 0);
  }

  // If prevIntervalHours requested, compute interval diffs (uses per-snapshot DB lookup)
  if (prevIntervalHours && Number(prevIntervalHours) > 0) {
    const intervalMs = Number(prevIntervalHours) * 60 * 60 * 1000;
    for (const snap of data) {
      const targetTimeIso = new Date(new Date(snap.time).getTime() - intervalMs).toISOString();
      const prevRes = await db.query(
        `SELECT id, created_at FROM epr_pwp_cer_snapshots WHERE created_at <= $1::timestamptz ORDER BY created_at DESC LIMIT 1`,
        [targetTimeIso]
      );
      if (!prevRes.rows.length) {
        snap.prev_snapshot_id = null;
        snap.prev_time = null;
        snap.data = snap.data.map((c) => ({
          ...c,
          prev_generated_interval: null,
          prev_transferred_interval: null,
          prev_available_interval: null,
          generated_diff_interval: null,
          transferred_diff_interval: null,
          available_diff_interval: null,
        }));
        continue;
      }
      const prevId = prevRes.rows[0].id;
      const prevTime = prevRes.rows[0].created_at;
      const prevDetails = await db.query(
        `SELECT category, generated, transferred, available FROM epr_pwp_cer_snapshot_details WHERE snapshot_id = $1`,
        [prevId]
      );
      const prevMap = {};
      prevDetails.rows.forEach((r) => {
        prevMap[r.category] = {
          generated: Number(r.generated),
          transferred: Number(r.transferred),
          available: Number(r.available),
        };
      });
      snap.prev_snapshot_id = prevId;
      snap.prev_time = prevTime;
      snap.data = snap.data.map((c) => {
        const prev = prevMap[c.category] || { generated: 0, transferred: 0, available: 0 };
        const prevGen = prev.generated;
        const prevTrans = prev.transferred;
        const prevAvail = prev.available;
        return {
          ...c,
          prev_generated_interval: prevGen,
          prev_transferred_interval: prevTrans,
          prev_available_interval: prevAvail,
          generated_diff_interval: Number(c.generated) - prevGen,
          transferred_diff_interval: Number(c.transferred) - prevTrans,
          available_diff_interval:
            Number(c.generated) - prevGen - (Number(c.transferred) - prevTrans),
        };
      });
    }
  }

  return {
    total,
    totalPages,
    currentPage: page,
    limit,
    data,
    grandTotals: grandTotals ?? { generated: 0, transferred: 0, available: 0 },
  };
};

// ══ Service ═══════════════════════════════════════════════════════════════════
// export const getAuditHistoryService = async ({
//   limit    = 10,
//   page     = 1,
//   category = null,
//   from     = null,   // "YYYY-MM-DD"
//   to       = null,   // "YYYY-MM-DD"
// }) => {
//   const offset = (page - 1) * limit;
 
//   // ── Build WHERE clause for snapshot date range ──────────────────────────────
//   const snapWhere  = [];
//   const snapParams = [];
 
//   if (from) {
//     snapParams.push(from);
//     snapWhere.push(`created_at >= $${snapParams.length}::date`);
//   }
//   if (to) {
//     snapParams.push(to);
//     // include the full "to" day by shifting to next day midnight
//     snapWhere.push(`created_at < ($${snapParams.length}::date + INTERVAL '1 day')`);
//   }
 
//   const snapWhereSQL = snapWhere.length ? `WHERE ${snapWhere.join(" AND ")}` : "";
 
//   // ── 1. Count total snapshots matching the date filter ───────────────────────
//   const countResult = await db.query(
//     `SELECT COUNT(*) AS total
//      FROM epr_pwp_cer_snapshots
//      ${snapWhereSQL}`,
//     snapParams
//   );
 
//   const total      = parseInt(countResult.rows[0].total);
//   const totalPages = Math.ceil(total / limit);
 
//   if (total === 0) {
//     return { total: 0, totalPages: 0, currentPage: page, limit, data: [] };
//   }
 
//   // ── 2. Fetch paginated snapshot IDs ─────────────────────────────────────────
//   const paginatedParams = [...snapParams, limit, offset];
//   const snapshots = await db.query(
//     `SELECT id, created_at
//      FROM epr_pwp_cer_snapshots
//      ${snapWhereSQL}
//      ORDER BY created_at DESC
//      LIMIT  $${paginatedParams.length - 1}
//      OFFSET $${paginatedParams.length}`,
//     paginatedParams
//   );
 
//   if (!snapshots.rows.length) {
//     return { total, totalPages, currentPage: page, limit, data: [] };
//   }
 
//   const snapshotIds = snapshots.rows.map((s) => s.id);
 
//   // ── 3. Fetch detail rows — optional category filter ──────────────────────────
//   const detailParams = [snapshotIds];
//   const catSQL = category
//     ? (() => {
//         detailParams.push(category);
//         return `AND s.category = $${detailParams.length}`;
//       })()
//     : "";
 
//   const rows = await db.query(
//     `SELECT
//        s.snapshot_id,
//        s.category,
//        s.generated,
//        s.transferred,
//        s.available,
//        COALESCE(d.generated_diff,   0) AS generated_diff,
//        COALESCE(d.transferred_diff, 0) AS transferred_diff,
//        COALESCE(d.available_diff,   0) AS available_diff,
//        snap.created_at                 AS snapshot_time
//      FROM epr_pwp_cer_snapshot_details s
//      LEFT JOIN epr_pwp_cer_deltas d
//        ON  s.snapshot_id = d.snapshot_id
//        AND s.category    = d.category
//      JOIN epr_pwp_cer_snapshots snap
//        ON  s.snapshot_id = snap.id
//      WHERE s.snapshot_id = ANY($1)
//      ${catSQL}
//      ORDER BY snap.created_at ASC, s.category`,
//     detailParams
//   );
 
//   // ── 4. Group by snapshot ─────────────────────────────────────────────────────
//   const snapshotMap = {};
//   for (const row of rows.rows) {
//     const key = row.snapshot_id;
//     if (!snapshotMap[key]) {
//       snapshotMap[key] = {
//         snapshot_id: key,
//         time:        row.snapshot_time,
//         data:        [],
//       };
//     }
//     snapshotMap[key].data.push({
//       category:         row.category,
//       generated:        Number(row.generated),
//       transferred:      Number(row.transferred),
//       available:        Number(row.available),
//       generated_diff:   Number(row.generated_diff),
//       transferred_diff: Number(row.transferred_diff),
//       available_diff:   Number(row.available_diff),
//     });
//   }
 
//   const data = Object.values(snapshotMap).sort(
//     (a, b) => new Date(a.time) - new Date(b.time)
//   );
 
//   return { total, totalPages, currentPage: page, limit, data };
// };
 
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