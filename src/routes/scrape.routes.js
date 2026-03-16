import express from "express";
import {
  getCurrentDataController,
  getNewAfterBaselineController,
  getNewCompaniesController,
  getRecentStatusChangesController,
  getStatusHistoryController,
  syncEprNational,
} from "../controllers/eprNational.controller.js";
import { scrapeAllMetalsController } from "../controllers/batteryMetalController.js";
import {
  getPwpNewCompaniesController,
  getPwpStatusChangesController,
  scrapePwpController,
} from "../controllers/pwp.controller.js";

const router = express.Router();

// ─── EPR National ─────────────────────────────────────────
router.post("/cpcb/epr-national", syncEprNational);

// ✅ New tracking endpoints
router.get("/pibo/current", getCurrentDataController);

router.get("/pibo/new-companies", getNewCompaniesController);

router.get("/pibo/status-changes", getRecentStatusChangesController);

router.get("/pibo/status-history/:regId", getStatusHistoryController);

// GET /api/epr-national/new-after-baseline              → saare naye
// GET /api/epr-national/new-after-baseline?status=Approved  → sirf Approved
// GET /api/epr-national/new-after-baseline?status=Pending   → sirf Pending
router.get("/pibo/new-after-baseline", getNewAfterBaselineController);
// ─── PWP ─────────────────────────────────────────────────
router.post("/pwp/scrape", scrapePwpController);
router.get("/pwp/new-companies", getPwpNewCompaniesController);
router.get("/pwp/status-changes", getPwpStatusChangesController);

//  ─── Manual trigger ─────────────────────────────────────────────────
router.get("/battery/scrape-all", scrapeAllMetalsController);

export default router;
