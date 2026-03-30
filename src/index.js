import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./config/db.config.js";
import scrapeRoutes from "./routes/scrape.routes.js";
import scrapePiboRoutes from "./routes/pibo.routes.js";
import scrapeEprCerRoutes from "./routes/eprCertificate.routes.js";
import { startBatteryScrapeJob } from "./workers/Batteryscrape.job.js";
import "./workers/cron.js";
import { startNationalWorker } from "./queue/national.worker.js"; // ✅ queue.js → worker.js
import { startPiboCron } from "./workers/pibo.cron.js";
import { startPwpCron } from "./workers/pwp.cron.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.use("/api", scrapeRoutes);
app.use("/api/pibo", scrapePiboRoutes);
app.use("/api/epr-cer", scrapeEprCerRoutes);

startNationalWorker();
startBatteryScrapeJob();
// server start ke baad
startPiboCron();
startPwpCron();

app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      message: "Server running successfully",
      time: result.rows[0].now,
    });
  } catch (error) {
    res.status(500).json({
      error: "Database connection failed",
    });
  }
});

app.listen(process.env.PORT || 5054, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 5054}`);
});
