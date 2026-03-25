import { scrapeCpcbPiboData } from "../scraper/Pibo.scraper.js";
import {
  getPiboStats,
  getPiboRecords,
  markPiboAsSeen,
  exportPiboRecords,
} from "../services/pibo.service.js";

// ─── POST /api/pibo/scrape ────────────────────────────────────────────────────
// Manually scraper trigger karo
export const triggerScrape = async (req, res) => {
  try {
    console.log("🚀 Manual PIBO scrape triggered");
    const result = await scrapeCpcbPiboData();

    if (!result.success) {
      return res.status(500).json({
        status: "error",
        message: result.error || "Scrape failed",
        data: result,
      });
    }

    res.json({
      status: "success",
      message: "PIBO scrape completed",
      data: {
        totalScraped:  result.totalScraped,
        newCompanies:  result.newCompanies,
        statusChanges: result.statusChanges,
        byEntity:      result.byEntity,
      },
    });
  } catch (err) {
    console.error("❌ triggerScrape error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── GET /api/pibo/stats ──────────────────────────────────────────────────────
// Frontend ke liye summary — total + newCount per entity
export const getStats = async (req, res) => {
  try {
    const data = await getPiboStats();
    res.json({ status: "success", data });
  } catch (err) {
    console.error("❌ getStats error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── GET /api/pibo/records ────────────────────────────────────────────────────
// Query params:
//   entity_type = "Brand Owner" | "Producer" | "Importer"
//   is_new      = "true" | "false"
//   page        = 1
//   limit       = 50
export const getRecords = async (req, res) => {
  try {
const { entity_type, is_new, page, limit, date, from_date, to_date, search } = req.query;

const data = await getPiboRecords({
  entity_type,
  is_new,
  page,
  limit,
  date,
  from_date,
  to_date,
  search, // ✅ add this
});

    res.json({ status: "success", data });
  } catch (err) {
    console.error("❌ getRecords error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── PATCH /api/pibo/mark-seen ────────────────────────────────────────────────
// Body options:
//   { entity_type: "Brand Owner" }   ← us entity ke sab new mark karo
//   { company_ids: [1, 2, 3] }       ← specific records mark karo
//   {}                               ← sab entities ke sab new mark karo
export const markAsSeen = async (req, res) => {
  try {
    const { entity_type, company_ids } = req.body;

    const result = await markPiboAsSeen({ entity_type, company_ids });

    res.json({
      status: "success",
      message: `${result.updated} records marked as seen`,
      data: result,
    });
  } catch (err) {
    console.error("❌ markAsSeen error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
};

export const exportPiboRecordsController = async (req, res) => {
  try {
    const data = await exportPiboRecords(req.query);
    res.json({
      status: "success",
      data,
    });

  } catch (err) {
    console.error("❌ export error:", err.message);
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
};