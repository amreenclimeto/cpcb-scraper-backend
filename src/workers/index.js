import { Worker } from "bullmq";
import { getRedisConnection } from "../queue/queueFactory.js";
import { runNationalJob } from "./national.worker.js";
import { scrapeCpcbPwpData } from "../services/scraper/cpcbPwp.scraper.js";

const connection = await getRedisConnection();

/* ===============================
   NATIONAL EPR WORKER
================================ */

new Worker(
  "national-epr",
  async job => {
    console.log("🔄 National job started:", job.id);
    await runNationalJob(job);
    console.log("✅ National job completed");
  },
  { connection }
);

console.log("👷 National worker ready");

/* ===============================
   PWP SCRAPER WORKER
================================ */

new Worker(
  "pwp-scraping",
  async job => {
    console.log("🔄 PWP job started:", job.id);

    const result = await scrapeCpcbPwpData();

    console.log("✅ PWP scraping completed");

    return result;
  },
  { connection }
);

console.log("👷 PWP worker ready");

/* ===============================
   SYSTEM READY
================================ */

console.log("🚀 All workers running");
