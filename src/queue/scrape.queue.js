import { getRedisConnection } from "./queueFactory.js";

const queues = {}; // cache created queues by name

export async function getQueue(queueName = "cpcb-scrape-jobs-light") {
  if (process.env.USE_REDIS !== "true") return null;
  if (queues[queueName]) return queues[queueName];

  const connection = await getRedisConnection();
  const bullmq = await import("bullmq");
  const QueueClass = bullmq.Queue || bullmq.default?.Queue || bullmq.default;
  const QueueSchedulerClass = bullmq.QueueScheduler || bullmq.default?.QueueScheduler || bullmq.default;

  const queue = new QueueClass(queueName, { connection });
  queues[queueName] = queue;

  try {
    if (typeof QueueSchedulerClass === "function") {
      // eslint-disable-next-line no-new
      new QueueSchedulerClass(queueName, {
        connection,
        stalledInterval: Number(process.env.BULLMQ_STALLED_INTERVAL_MS) || 30000,
      });
    } else {
      console.warn("⚠️ QueueScheduler not available via bullmq import");
    }
  } catch (e) {
    console.warn("⚠️ Failed to create QueueScheduler for", queueName, e.message);
  }

  return queue;
}

export async function enqueueScrapeJob(jobType, payload = {}, queueName = "cpcb-scrape-jobs-light") {
  const queue = await getQueue(queueName);
  if (!queue) return null;

  return queue.add(jobType, payload, {
    removeOnComplete: 20,
    removeOnFail: 50,
    attempts: 2,
    backoff: { type: "fixed", delay: 30000 },
  });
}

export async function registerRecurringScrapeJobs() {
  // create both queues
  const lightQueue = await getQueue("cpcb-scrape-jobs-light");
  const heavyQueue = await getQueue("cpcb-scrape-jobs-heavy");
  if (!lightQueue || !heavyQueue) return;

  const tz = process.env.SCRAPE_TIMEZONE || "Asia/Kolkata";
  const lightPattern = process.env.SCRAPE_LIGHT_CRON || "30 */2 * * *"; // light jobs every 2 hours at :30
  const heavyPattern = process.env.SCRAPE_HEAVY_CRON || "30 */6 * * *"; // heavy jobs every 6 hours at :30
  const lightJobs = ["epr-certificate", "pwp"];
  const heavyJobs = ["national", "pibo", "battery"];

  // Ensure a QueueScheduler exists to properly handle repeatable jobs
  // QueueSchedulers already created in getQueue
  const connection = await getRedisConnection();

  // helper to add repeatable safely
  const addRepeatableToQueue = async (q, name, cronPattern) => {
    const jobId = `repeat-${name}`;
    try {
      const keys = await q.getRepeatableJobs();
      for (const k of keys) {
        if (k.id === jobId) {
          await q.removeRepeatableByKey(k.key);
        }
      }
    } catch (e) {}

    await q.add(name, { source: "scheduler" }, {
      jobId,
      repeat: { cron: cronPattern, tz },
      removeOnComplete: 10,
      removeOnFail: 20,
    });
  };

  // register light jobs
  for (const name of lightJobs) {
    await addRepeatableToQueue(lightQueue, name, lightPattern);
  }
  for (const name of heavyJobs) {
    await addRepeatableToQueue(heavyQueue, name, heavyPattern);
  }

  console.log(`⏰ Registered recurring scrape jobs (light:${lightPattern}, heavy:${heavyPattern}) (${tz})`);
}
