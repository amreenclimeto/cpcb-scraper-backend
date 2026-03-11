import { getNationalQueue } from "../queue/national.queue.js";
import { saveNationalEprToPG, searchNationalByLegalName } from "../services/eprNational.service.js";
import fetchNationalDashboard from "../scraper/eprNational.scraper.js";  // ← missing

export const syncEprNational = async (req, res) => {
  const queue = await getNationalQueue();

  // LOCAL MODE (Redis disabled)
  if (!queue) {
    const result = await fetchNationalDashboard();

    if (!result.success) {
      return res.status(500).json({ status: "error", message: result.error });
    }

    const stats = await saveNationalEprToPG(result.rows);
    return res.json({ status: "success", mode: "local-direct", ...stats });
  }

  // PRODUCTION MODE (Redis enabled)
  const job = await queue.add("sync-national");
  return res.json({
    status: "success",
    mode: "queue",
    jobId: job.id,
  });
};

export const searchEprNational = async (req, res) => {
  try {
    const { legalName } = req.query;

    if (!legalName) {
      return res.status(400).json({
        status: "error",
        message: "legalName is required",
      });
    }

    const data = await searchNationalByLegalName(legalName);

    if (!data) {
      return res.json({
        status: "success",
        data: null,
        message: "No record found",
      });
    }

    res.json({
      status: "success",
      data,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
};
