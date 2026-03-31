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
  const tz = process.env.SCRAPE_TIMEZONE || "Asia/Kolkata";
  const jobs = ["national", "pibo", "pwp", "battery", "epr-certificate"];

  // Ensure a QueueScheduler exists to properly handle repeatable jobs
  const bullmq = await import("bullmq");
  const QueueSchedulerClass =
    bullmq.QueueScheduler || bullmq.default?.QueueScheduler || bullmq.default;

  const connection = await getRedisConnection();
  if (typeof QueueSchedulerClass === "function") {
    // eslint-disable-next-line no-new
    new QueueSchedulerClass("cpcb-scrape-jobs", { connection });
  } else {
    console.warn(
      "⚠️ QueueScheduler not available from bullmq import; repeatable jobs might not be managed automatically.",
      Object.keys(bullmq)
    );
  }

  for (const name of jobs) {
    // Remove any existing repeatable with same jobId to avoid duplicates
    const jobId = `repeat-${name}`;
    await queue.removeRepeatableByKey(`cpcb-scrape-jobs:${jobId}:${pattern}`);

    await queue.add(
      name,
      { source: "scheduler" },
      {
        jobId,
        repeat: {
          cron: pattern,
          tz,
        },
        removeOnComplete: 10,
        removeOnFail: 20,
      }
    );
  }

  console.log(`⏰ Registered recurring scrape jobs with cron: ${pattern} (${tz})`);
}
