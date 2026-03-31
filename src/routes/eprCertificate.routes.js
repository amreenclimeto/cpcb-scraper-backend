import express from "express";
import {
  runScraperController,
  getLatestAudit,
  getAuditHistoryController,
  getCategoryHistoryController,
} from "../controllers/eprCertificate.controller.js";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const allowedOrigins = [
  process.env.FRONTEND_URL || "https://cpcb-scraper-frontend.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173", "https://cpcb-scraper-frontend.vercel.app/",
];

const corsOptions = {
  origin(origin, callback) {
    // allow non-browser callers
    if (!origin) return callback(null, true);
    const normalized = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(normalized) || /^https:\/\/cpcb-scraper-frontend(-[a-z0-9-]+)?\.vercel\.app$/i.test(normalized)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

const router = express.Router();

// 🔥 Run manually
router.post("/run", runScraperController);

// 📊 Latest audit
router.get("/latest", getLatestAudit);

// GET   http://localhost:3000/api/epr-cer/history?limit=10&category=Cat I(Recycling)
// Use permissive route-level CORS for this endpoint (reflect origin, allow credentials)
const permissiveCors = cors({ origin: true, credentials: true, methods: ["GET", "OPTIONS"] });

// Normalize some non-standard origins (e.g. apps/webviews that send "0")
function normalizeOrigin(req, res, next) {
  try {
    const origin = req.headers.origin;
    if (origin === "0" || origin === 0) {
      req.headers.origin = process.env.FRONTEND_URL || "https://cpcb-scraper-frontend.vercel.app";
    }
  } catch (e) {
    // ignore
  }
  next();
}

router.options("/history", normalizeOrigin, permissiveCors);
router.get("/history", normalizeOrigin, permissiveCors, getAuditHistoryController);
 
// GET   /api/epr/category/Cat%20II(EOL)
router.get("/category/:category", getCategoryHistoryController);

export default router;