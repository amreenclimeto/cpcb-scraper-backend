import {
  getCurrentDataService,
  getLatestCreatedOn,
  getNewCompaniesService,
  getNewAfterBaselineService,       // 🆕 single function, status filter inside
  getRecentStatusChangesService,
  getStatusHistoryService,
  saveScrapedData,
} from "../services/eprNational.service.js";
import { getNationalQueue } from "../queue/national.queue.js";
import fetchNationalDashboard from "../scraper/eprNational.scraper.js";

// ─────────────────────────────────────────────────────────
// POST /api/epr-national/sync
// ─────────────────────────────────────────────────────────
// export const syncEprNational = async (req, res) => {
//   try {
//     const lastCreatedOn = await getLatestCreatedOn();
//     console.log("📅 Scraping after:", lastCreatedOn);

//     const queue = await getNationalQueue();

//     if (!queue) {
//       const result = await fetchNationalDashboard(lastCreatedOn);

//       if (!result.success) {
//         return res.status(500).json({
//           status: "error",
//           message: result.error,
//           partialRows: result.total,
//         });
//       }

//       if (result.rows.length === 0) {
//         return res.json({
//           status: "success",
//           message: "No new records found",
//           scraped: 0,
//         });
//       }

//       const stats = await saveScrapedData(result.rows);

//       return res.json({
//         status: "success",
//         mode: "local-direct",
//         scraped: result.total,
//         isFirstScrape: stats.isFirstScrape,
//         ...stats,
//       });
//     }

//     const job = await queue.add("sync-national", { lastCreatedOn });
//     return res.json({ status: "queued", mode: "queue", jobId: job.id });

//   } catch (err) {
//     return res.status(500).json({ status: "error", message: err.message });
//   }
// };
export const syncEprNational = async (req, res) => {
  try {
    const lastCreatedOn = await getLatestCreatedOn();
    console.log("📅 Scraping after:", lastCreatedOn);

    const result = await fetchNationalDashboard(lastCreatedOn);

    if (!result.success) {
      return res.status(500).json({
        status: "error",
        message: result.error,
        partialRows: result.total,
      });
    }

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
      mode: "direct",
      scraped: result.total,
      isFirstScrape: stats.isFirstScrape,
      ...stats,
    });

  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
};
// ─────────────────────────────────────────────────────────
// GET /api/epr-national/new-after-baseline
//
// Query params:
//   ?status=Approved   → sirf approved records
//   ?status=Pending    → sirf pending
//   (no param)         → saare naye records
//
// Examples:
//   GET /api/epr-national/new-after-baseline
//   GET /api/epr-national/new-after-baseline?status=Approved
//   GET /api/epr-national/new-after-baseline?status=Pending
// ─────────────────────────────────────────────────────────
export const getNewAfterBaselineController = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      search,
    } = req.query;

    const result = await getNewAfterBaselineService({
      page: Number(page),
      limit: Number(limit),
      statusFilter: status ?? null,
      search: search ?? null,
    });

    res.json({
      status: "success",
      meta: {
        baselineCount: result.baselineCount,
        baselineSetAt: result.baselineSetAt,
        currentTotal: result.currentTotal,
        addedAfterBaseline: result.addedAfterBaseline,
        filteredCount: result.filteredCount,
        appliedFilter: result.appliedFilter,
      },
      total: result.total, // ✅ pagination total
      page: result.page,
      limit: result.limit,
      data: result.data,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// EXISTING CONTROLLERS (unchanged)
// ─────────────────────────────────────────────────────────

export const getNewCompaniesController = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      entityType,
      status,
      search,
    } = req.query;

    const result = await getNewCompaniesService({
      page: Number(page),
      limit: Number(limit),
      entityType,
      status,
      search,
    });

    res.json({
      status: "success",
      summary: result.summary,
      total: result.total,
      page: result.page,
      limit: result.limit,
      data: result.data,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
};

export const getRecentStatusChangesController = async (req, res) => {
  try {
    const data = await getRecentStatusChangesService();
    res.json({
      status: "success",
      count: data.length,
      date: new Date().toISOString(),
      data: data.map((row) => ({
        reg_id: row.reg_id,
        application_id: row.application_id,
        company_legal_name: row.company_legal_name,
        company_trade_name: row.company_trade_name,
        applicant_type: row.applicant_type,
        date_of_application: row.created_on,
        first_seen_at: row.first_seen_at,
        old_status: row.old_status,
        new_status: row.new_status,
        changed_at: row.changed_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};
export const getCurrentDataController = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      entityType,
      status,
      search,
    } = req.query;

    const result = await getCurrentDataService({
      page: Number(page),
      limit: Number(limit),
      entityType,
      status,
      search,
    });

    res.json({
      status: "success",
      ...result,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
};

export const getStatusHistoryController = async (req, res) => {
  try {
    const { regId } = req.params;
    const data = await getStatusHistoryService(regId);
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};