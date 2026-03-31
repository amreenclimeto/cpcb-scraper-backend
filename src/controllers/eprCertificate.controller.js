import { getAuditHistoryService, getCategoryHistoryService, runEprScraper } from "../services/eprCertificate.service.js";
import db from "../config/db.config.js";
import { enqueueScrapeJob } from "../queue/scrape.queue.js";

// 🔹 Run scraper manually
export const runScraperController = async (req, res) => {
  try {
    if (process.env.USE_REDIS === "true") {
      const job = await enqueueScrapeJob("epr-certificate", { source: "api" });
      return res.status(202).json({
        success: true,
        status: "queued",
        message: "EPR certificate scrape queued",
        jobId: job?.id,
      });
    }

    const result = await runEprScraper();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🔹 Get latest snapshot + diff
export const getLatestAudit = async (req, res) => {
  try {
    const snapshot = await db.query(
      `SELECT * FROM epr_pwp_cer_snapshots ORDER BY created_at DESC LIMIT 1`
    );

    if (!snapshot.rows.length) {
      return res.json({
        message: "No data found",
        data: [],
      });
    }

    const snapshotId = snapshot.rows[0].id;

    const data = await db.query(
      `SELECT d.category, s.generated, d.generated_diff
       FROM epr_pwp_cer_snapshot_details s
       JOIN epr_pwp_cer_deltas d 
       ON s.snapshot_id = d.snapshot_id AND s.category = d.category
       WHERE s.snapshot_id = $1`,
      [snapshotId]
    );

    res.json({
      timestamp: snapshot.rows[0].created_at,
      data: data.rows,
    });
  } catch (err) {
    console.error("❌ Latest Audit Error:", err);
    res.status(500).json({ error: err.message });
  }
};


// ─────────────────────────────────────────────
// GET /api/epr/history
// All snapshots grouped by time — for chart
// Query: ?limit=10&category=Total
// ─────────────────────────────────────────────
export const getAuditHistoryController = async (req, res) => {
  try {
    const limit    = parseInt(req.query.limit) || 10;
    const category = req.query.category || null;
 
    const result = await getAuditHistoryService({ limit, category });
 
    res.json({
      success:          true,
      total_snapshots:  result.length,
      data:             result,
    });
  } catch (error) {
    console.error("❌ getAuditHistoryController:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
 
// ─────────────────────────────────────────────
// GET /api/epr/category/:category
// Single category across all snapshots
// e.g. GET /api/epr/category/Cat%20II(EOL)
// ─────────────────────────────────────────────
export const getCategoryHistoryController = async (req, res) => {
  try {
    const { category } = req.params;
 
    const result = await getCategoryHistoryService(category);
 
    if (!result.length) {
      return res.json({
        success:  true,
        category,
        message:  "No data found for this category",
        data:     [],
      });
    }
 
    res.json({
      success:          true,
      category,
      total_snapshots:  result.length,
      data:             result,
    });
  } catch (error) {
    console.error("❌ getCategoryHistoryController:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
 