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

  const tz = process.env.SCRAPE_TIMEZONE || "Asia/Kolkata";
  const lightPattern = process.env.SCRAPE_LIGHT_CRON || "30 */2 * * *"; // light jobs every 2 hours at :30
  const heavyPattern = process.env.SCRAPE_HEAVY_CRON || "30 */6 * * *"; // heavy jobs every 6 hours at :30
  const lightJobs = ["epr-certificate", "pwp"];
  const heavyJobs = ["national", "pibo", "battery"];

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

  // helper to add repeatable safely
  const addRepeatable = async (name, cronPattern) => {
    const jobId = `repeat-${name}`;
    // remove existing repeatables with same jobId (best-effort)
    try {
      const keys = await queue.getRepeatableJobs();
      for (const k of keys) {
        if (k.id === jobId) {
          await queue.removeRepeatableByKey(k.key);
        }
      }
    } catch (e) {
      // ignore
    }

    await queue.add(
      name,
      { source: "scheduler" },
      {
        jobId,
        repeat: {
          cron: cronPattern,
          tz,
        },
        removeOnComplete: 10,
        removeOnFail: 20,
      }
    );
  };

  // register light jobs
  for (const name of lightJobs) {
    await addRepeatable(name, lightPattern);
  }
  // register heavy jobs
  for (const name of heavyJobs) {
    await addRepeatable(name, heavyPattern);
  }

  console.log(`⏰ Registered recurring scrape jobs (light:${lightPattern}, heavy:${heavyPattern}) (${tz})`);
}
