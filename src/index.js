import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./config/db.config.js";
import scrapeRoutes from "./routes/scrape.routes.js";
import { startBatteryScrapeJob } from "./workers/Batteryscrape.job.js";
import "./workers/cron.js";
import { startNationalWorker } from "./queue/national.worker.js"; // ✅ queue.js → worker.js

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.use("/api", scrapeRoutes);

startNationalWorker();
startBatteryScrapeJob();

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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});