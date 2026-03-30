import express from "express";
import {
  runScraperController,
  getLatestAudit,
  getAuditHistoryController,
  getCategoryHistoryController,
} from "../controllers/eprCertificate.controller.js";

const router = express.Router();

// 🔥 Run manually
router.post("/run", runScraperController);

// 📊 Latest audit
router.get("/latest", getLatestAudit);

// GET   http://localhost:3000/api/epr-cer/history?limit=10&category=Cat I(Recycling)
router.get("/history", getAuditHistoryController);
 
// GET   /api/epr/category/Cat%20II(EOL)
router.get("/category/:category", getCategoryHistoryController);

export default router;