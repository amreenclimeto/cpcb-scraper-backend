import { getRedisConnection } from "./queueFactory.js";

let nationalQueue = null;

export async function getNationalQueue() {
  if (process.env.USE_REDIS !== "true") return null;

  if (nationalQueue) return nationalQueue;

  const { Queue } = await import("bullmq");
  const connection = await getRedisConnection();

  nationalQueue = new Queue("national-epr", { connection });

  return nationalQueue;
}
