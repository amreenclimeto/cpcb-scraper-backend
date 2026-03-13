import express from "express";
import { getCurrentDataController, getNewCompaniesController, getRecentStatusChangesController, getStatusHistoryController, syncEprNational } from "../controllers/eprNational.controller.js";
import { scrapeAllMetalsController } from "../controllers/batteryMetalController.js";


const router = express.Router();


router.post("/cpcb/epr-national", syncEprNational);

// ✅ New tracking endpoints
router.get("/pibo/current", getCurrentDataController);

router.get("/pibo/new-companies", getNewCompaniesController);

router.get("/pibo/status-changes", getRecentStatusChangesController);

router.get("/pibo/status-history/:regId", getStatusHistoryController);


// Manual trigger
router.get("/battery/scrape-all", scrapeAllMetalsController);


export default router;
