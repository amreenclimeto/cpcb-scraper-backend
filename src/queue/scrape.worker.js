import { Worker } from "bullmq";
import { getRedisConnection } from "./queueFactory.js";
import { runNationalJob } from "../workers/national.worker.js";
import { scrapeCpcbPiboData } from "../scraper/Pibo.scraper.js";
import { scrapeCpcbPwpData } from "../scraper/pwp.scraper.js";
import { runFullScrape } from "../controllers/batteryMetalController.js";
import { runEprScraper } from "../services/eprCertificate.service.js";

export async function startScrapeWorker() {
  if (process.env.USE_REDIS !== "true") {
    console.log("⚠️ Redis disabled, scrape worker not started");
    return null;
  }

  const connection = await getRedisConnection();

  const worker = new Worker(
    "cpcb-scrape-jobs",
    async (job) => {
      switch (job.name) {
        case "national":
          return runNationalJob(job);
        case "pibo":
          return scrapeCpcbPiboData();
        case "pwp":
          return scrapeCpcbPwpData();
        case "battery":
          return runFullScrape();
        case "epr-certificate":
          return runEprScraper();
        default:
          throw new Error(`Unknown scrape job type: ${job.name}`);
      }
    },
    {
      connection,
      concurrency: Number(process.env.SCRAPE_WORKER_CONCURRENCY) || 2,
    }
  );

  worker.on("completed", (job) => {
    console.log(`✅ Scrape job completed: ${job.name} (${job.id})`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ Scrape job failed: ${job?.name} (${job?.id})`, err.message);
  });

  console.log("🚀 Scrape queue worker started");
  return worker;
}
