import {
  getCurrentDataService,
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
    const queue = await getNationalQueue();

    if (!queue) {
      const result = await fetchNationalDashboard();
      if (!result.success) {
        return res.status(500).json({
          status: "error",
          message: result.error,
          partialRows: result.total,
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

    const job = await queue.add("sync-national");
    return res.json({ status: "queued", mode: "queue", jobId: job.id });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

export const getCurrentDataController = async (req,res) => {

  const data = await getCurrentDataService();
  res.json({status:"success",data});

};


export const getNewCompaniesController = async (req,res) => {

  const days = req.query.days || 1;

  const data = await getNewCompaniesService(days);

  res.json({status:"success",data});

};


export const getRecentStatusChangesController = async (req,res) => {

  const days = req.query.days || 1;

  const data = await getRecentStatusChangesService(days);

  res.json({status:"success",data});

};


export const getStatusHistoryController = async (req,res) => {

  const { regId } = req.params;

  const data = await getStatusHistoryService(regId);

  res.json({status:"success",data});

};