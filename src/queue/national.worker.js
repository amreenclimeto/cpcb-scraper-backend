// queue/national.worker.js  ← naya file
import { getRedisConnection } from "./queueFactory.js";
import { runNationalJob } from "../workers/national.worker.js";

export async function startNationalWorker() {
  if (process.env.USE_REDIS !== "true") {
    console.log("⚠️ Redis disabled, worker not started");
    return;
  }

  const { Worker } = await import("bullmq");
  const connection = await getRedisConnection();

  const worker = new Worker("national-epr", runNationalJob, { connection });

  worker.on("failed", (job, err) => {
    console.error(`❌ Job ${job.id} failed:`, err.message);
  });

  console.log("🚀 National worker started");
}
