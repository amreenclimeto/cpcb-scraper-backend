import { Worker } from "bullmq";
import { getRedisConnection } from "./queueFactory.js";
import { runNationalJob } from "../workers/national.worker.js";
import { scrapeCpcbPiboData } from "../scraper/Pibo.scraper.js";
import { scrapeCpcbPwpData } from "../scraper/pwp.scraper.js";
import { runFullScrape } from "../controllers/batteryMetalController.js";
import { runEprScraper } from "../services/eprCertificate.service.js";

function getHandlerForJob(name) {
  switch (name) {
    case "national":
      return (job) => runNationalJob(job);
    case "pibo":
      return () => scrapeCpcbPiboData();
    case "pwp":
      return () => scrapeCpcbPwpData();
    case "battery":
      return () => runFullScrape();
    case "epr-certificate":
      return () => runEprScraper();
    default:
      return null;
  }
}

export async function startScrapeWorker(queueName = "cpcb-scrape-jobs-light", concurrency = Number(process.env.SCRAPE_WORKER_CONCURRENCY) || 2) {
  if (process.env.USE_REDIS !== "true") {
    console.log("⚠️ Redis disabled, scrape worker not started for", queueName);
    return null;
  }

  const connection = await getRedisConnection();

  const worker = new Worker(
    queueName,
    async (job) => {
      const handler = getHandlerForJob(job.name);
      if (!handler) throw new Error(`Unknown scrape job type: ${job.name}`);
      return handler(job);
    },
    {
      connection,
      concurrency,
      lockDuration: Number(process.env.SCRAPE_JOB_LOCK_MS) || 1000 * 60 * 60 * 2,
    }
  );

  worker.on("completed", (job) => {
    console.log(`✅ Scrape job completed: ${job.name} (${job.id}) on ${queueName}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ Scrape job failed: ${job?.name} (${job?.id}) on ${queueName}`, err?.message || err);
  });

  console.log(`🚀 Scrape worker started for ${queueName} (concurrency=${concurrency})`);
  return worker;
}
