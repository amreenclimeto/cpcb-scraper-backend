import express from "express";
import {
  triggerScrape,
  getStats,
  getRecords,
  markAsSeen,
} from "../controllers/pibo.controller.js";

const router = express.Router();

// ─── Scraper ──────────────────────────────────────────────────────────────────
// POST /api/pibo/scrape
// Manually scraper trigger karo (cron ya manual dono ke liye)
router.post("/scrape", triggerScrape);

// ─── Stats ────────────────────────────────────────────────────────────────────
// GET /api/pibo/stats
// Response: { brandOwner: { total, newCount }, producer: {...}, importer: {...} }
router.get("/stats", getStats);

// ─── Records ──────────────────────────────────────────────────────────────────
// GET /api/pibo/records?entity_type=Brand Owner&is_new=true&page=1&limit=50
router.get("/records", getRecords);

// ─── Mark Seen ────────────────────────────────────────────────────────────────
// PATCH /api/pibo/mark-seen
// Body: { entity_type: "Brand Owner" } OR { company_ids: [1,2,3] } OR {}
router.patch("/mark-seen", markAsSeen);

export default router;