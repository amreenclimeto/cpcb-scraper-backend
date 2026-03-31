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
router.options("/history", cors(corsOptions));
router.get("/history", cors(corsOptions), getAuditHistoryController);
 
// GET   /api/epr/category/Cat%20II(EOL)
router.get("/category/:category", getCategoryHistoryController);

export default router;