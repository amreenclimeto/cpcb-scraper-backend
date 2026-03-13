import {
  getCurrentDataService,
  getLatestCreatedOn,
  getNewCompaniesService,
  getRecentStatusChangesService,
  getStatusHistoryService,
  saveScrapedData
} from "../services/eprNational.service.js";
import { getNationalQueue } from "../queue/national.queue.js";
import fetchNationalDashboard from "../scraper/eprNational.scraper.js";

// ─────────────────────────────────────────────────────────
// POST /api/epr-national/sync
// ─────────────────────────────────────────────────────────
export const syncEprNational = async (req, res) => {
  try {

    // 🆕 DB se latest date lo
    const lastCreatedOn = await getLatestCreatedOn();
    console.log("📅 Scraping after:", lastCreatedOn);
    const queue = await getNationalQueue();

    if (!queue) {
      const result = await fetchNationalDashboard(lastCreatedOn);
      if (!result.success) {
        return res.status(500).json({
          status: "error",
          message: result.error,
          partialRows: result.total,
        });
      }

       // Agar koi naya record nahi mila
      if (result.rows.length === 0) {
        return res.json({
          status: "success",
          message: "No new records found",
          scraped: 0,
        });
      }

      const stats = await saveScrapedData(result.rows);
      return res.json({
        status: "success",
        mode: "local-direct",
        scraped: result.total,
        ...stats,
      });
    }

   // Queue mein bhi lastCreatedOn pass karo
    const job = await queue.add("sync-national", { lastCreatedOn });
    return res.json({ status: "queued", mode: "queue", jobId: job.id });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// getNewCompaniesController — days parameter hatao
export const getNewCompaniesController = async (req, res) => {
  try {
    const result = await getNewCompaniesService(); // no days

    res.json({
      status: "success",
      summary: {
        previousTotal: result.previousTotal,
        currentTotal: result.currentTotal,
        newCount: result.newCount,
      },
      data: result.data,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// getRecentStatusChangesController — days optional rakho
export const getRecentStatusChangesController = async (req, res) => {
  try {
    const days = req.query.days || 7; // default 7 days
    const data = await getRecentStatusChangesService(days);

    res.json({ status: "success", count: data.length, data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// getCurrentDataController — try/catch add karo
export const getCurrentDataController = async (req, res) => {
  try {
    const data = await getCurrentDataService();
    res.json({ status: "success", total: data.length, data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// getStatusHistoryController — try/catch add karo  
export const getStatusHistoryController = async (req, res) => {
  try {
    const { regId } = req.params;
    const data = await getStatusHistoryService(regId);
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};