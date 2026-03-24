import { scrapeCpcbPwpData } from "../scraper/pwp.scraper.js";
import { getPwpNewCompaniesService, getPwpRecordsService, getPwpStatusChangesService } from "../services/pwp.service.js";

// POST /api/pwp/scrape
// POST /api/pwp/scrape
export const scrapePwpController = async (req, res) => {
  try {
    console.log("🚀 PWP scrape triggered via API");

    const result = await scrapeCpcbPwpData();

    if (!result.success) {
      return res.status(500).json({
        status: "error",
        message: result.error,
      });
    }

    return res.json({
      status: "success",
      summary: {
        totalScraped: result.totalScraped,
        newCompanies: result.newCompanies,
        statusChanges: result.statusChanges,
      },
    });

  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// GET /api/pwp/new-companies
export const getPwpNewCompaniesController = async (req, res) => {
  try {
    const result = await getPwpNewCompaniesService();

    return res.json({
      status: "success",
      summary: {
        previousTotal: result.previousTotal,
        currentTotal: result.currentTotal,
        newCount: result.newCount,
      },
      data: result.data,
    });

  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// GET /api/pwp/status-changes
export const getPwpStatusChangesController = async (req, res) => {
  try {
    const data = await getPwpStatusChangesService();

    return res.json({
      status: "success",
      date: new Date().toISOString(),
      count: data.length,
      data,
    });

  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

export const getPwpRecords = async (req, res) => {
  try {
    const result = await getPwpRecordsService(req.query);

    res.json({
      status: "success",
      data: result,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
};