import { getRedisConnection } from "./queueFactory.js";

let scrapeQueue = null;

export async function getScrapeQueue() {
  if (process.env.USE_REDIS !== "true") return null;
  if (scrapeQueue) return scrapeQueue;

  const { Queue } = await import("bullmq");
  const connection = await getRedisConnection();
  scrapeQueue = new Queue("cpcb-scrape-jobs", { connection });
  return scrapeQueue;
}

export async function enqueueScrapeJob(jobType, payload = {}) {
  const queue = await getScrapeQueue();
  if (!queue) return null;

  return queue.add(jobType, payload, {
    removeOnComplete: 20,
    removeOnFail: 50,
    attempts: 2,
    backoff: { type: "fixed", delay: 30000 },
  });
}

export async function registerRecurringScrapeJobs() {
  const queue = await getScrapeQueue();
  if (!queue) return;

  const pattern = process.env.SCRAPE_INTERVAL_CRON || "0 */2 * * *";
  const jobs = ["national", "pibo", "pwp", "battery", "epr-certificate"];

  for (const name of jobs) {
    await queue.add(name, { source: "scheduler" }, {
      jobId: `repeat-${name}`,
      repeat: { pattern },
      removeOnComplete: 10,
      removeOnFail: 20,
    });
  }

  console.log(`⏰ Registered recurring scrape jobs with cron: ${pattern}`);
}
